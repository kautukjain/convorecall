import { randomUUID } from "node:crypto";
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { JobState, TranscriptSegment } from "@prisma/client";
import type { CallNotes, JobExitStatus } from "@opengong/types";
import { ProblemException } from "../../common/problem.js";
import { PrismaService } from "../../database/prisma.service.js";
import { AiOrchestratorService } from "../ai/ai-orchestrator.service.js";
import type { ExtractionSource } from "../ai/extraction-source.js";
import {
  CompositeExtractionSource,
  RecapExtractionSource,
} from "../ai/recap-extraction.source.js";
import { RecapClient } from "../ai/recap.client.js";
import { ReplayExtractorService } from "../ai/replay-extractor.service.js";
import { detectAudioType } from "../calls/audio-signature.js";
import { StorageService } from "../calls/storage.service.js";
import { UrlFetchService } from "../calls/url-fetch.service.js";
import { NotesRepository } from "../notes/notes.repository.js";
import { NotesService } from "../notes/notes.service.js";
import { FixtureSttProvider } from "../transcript/providers/fixture-stt.provider.js";
import { PyAiSttProvider } from "../transcript/providers/pyai-stt.provider.js";
import { SpeakerNamingService } from "../transcript/speaker-naming.service.js";
import type { SttSpeakerName } from "../transcript/stt.types.js";
import { TranscriptRepository } from "../transcript/transcript.repository.js";
import { JobEventsService } from "./job-events.service.js";
import { JobsRepository, type ClaimedJob } from "./jobs.repository.js";

const EXTENSION_BY_TYPE: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/mp4": "mp4",
  "audio/m4a": "m4a",
  "audio/webm": "webm",
};

/**
 * In-process worker (ADR-008).
 *
 * `WORKER_ENABLED=false` is the seam for splitting this into its own process later:
 * the queue is already a table and the claim is already atomic, so that becomes a
 * deployment change rather than a redesign.
 */
@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WorkerService.name);
  private readonly workerId = `worker-${randomUUID().slice(0, 8)}`;
  private readonly running = new Set<string>();
  private timers: NodeJS.Timeout[] = [];
  private stopped = false;

  constructor(
    private readonly jobs: JobsRepository,
    private readonly events: JobEventsService,
    private readonly transcripts: TranscriptRepository,
    private readonly fixtures: FixtureSttProvider,
    private readonly pyai: PyAiSttProvider,
    private readonly speakers: SpeakerNamingService,
    private readonly replay: ReplayExtractorService,
    private readonly recap: RecapClient,
    private readonly storage: StorageService,
    private readonly urls: UrlFetchService,
    private readonly orchestrator: AiOrchestratorService,
    private readonly notes: NotesService,
    private readonly notesRepository: NotesRepository,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get<boolean>("WORKER_ENABLED") === false) {
      this.logger.warn("WORKER_ENABLED=false — jobs will queue but not run");
      return;
    }

    // Sweep first: a previous process may have died mid-job, and those rows must reach
    // a terminal state or return to the queue before anything new is claimed.
    void this.sweep();

    const pollMs = this.config.get<number>("WORKER_POLL_INTERVAL_MS") ?? 2_000;
    this.timers.push(setInterval(() => void this.tick(), pollMs));
    this.timers.push(setInterval(() => void this.sweep(), pollMs * 5));
    this.logger.log(`${this.workerId} started (poll ${pollMs}ms)`);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  private async sweep(): Promise<void> {
    try {
      const staleAfter = this.config.get<number>("WORKER_STALE_AFTER_MS") ?? 60_000;
      const maxAttempts = this.config.get<number>("JOB_MAX_ATTEMPTS") ?? 3;
      await this.jobs.expireOverdue();
      await this.jobs.reclaimStale(staleAfter, maxAttempts);
    } catch (error) {
      this.logger.error(
        `Sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async tick(): Promise<void> {
    const concurrency = this.config.get<number>("WORKER_CONCURRENCY") ?? 2;
    while (!this.stopped && this.running.size < concurrency) {
      let job: ClaimedJob | null = null;
      try {
        job = await this.jobs.claimNext(this.workerId);
      } catch (error) {
        this.logger.error(
          `Claim failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      if (!job) return;

      this.running.add(job.id);
      void this.process(job).finally(() => this.running.delete(job.id));
    }
  }

  private async process(job: ClaimedJob): Promise<void> {
    const startedAt = Date.now();
    const heartbeatMs = this.config.get<number>("WORKER_HEARTBEAT_MS") ?? 10_000;
    const heartbeat = setInterval(() => {
      void this.jobs.heartbeat(job.id).catch(() => undefined);
    }, heartbeatMs);

    try {
      await this.events.append(job.id, "state", {
        state: job.state.toLowerCase(),
        at: new Date().toISOString(),
      });

      if (job.source === "FIXTURE") {
        // Fixture jobs arrive already in EXTRACTING — there is nothing to transcribe.
        await this.loadFixtureTranscript(job);
      } else {
        await this.transcribe(job);
      }

      await this.extract(job, startedAt);
    } catch (error) {
      // ProblemException carries the client-safe message in `message` and the useful
      // cause in `operatorDetail`. Recording only the former made failures read as
      // "Transcription failed." with nothing to act on.
      const operator =
        error instanceof ProblemException
          ? `${error.message}${error.operatorDetail ? ` — ${error.operatorDetail}` : ""}`
          : error instanceof Error
            ? error.message
            : String(error);
      // Two audiences: `failureMessage` is what the user reads, `lastError` is what an
      // operator debugs from. Conflating them either leaks internals or says nothing.
      const userFacing =
        error instanceof ProblemException
          ? error.detail
          : "Something went wrong while processing this call.";
      await this.jobs
        .transition(job.id, "FAILED", {
          failureReason: "processing_error",
          failureMessage: userFacing,
          lastError: operator,
        })
        .catch(() => undefined);
      await this.events
        .append(job.id, "error", {
          code: "internal_error",
          message: "Processing failed.",
        })
        .catch(() => undefined);
      this.logger.error(`Job ${job.id} failed: ${operator}`);
    } finally {
      clearInterval(heartbeat);
    }
  }

  /**
   * Runs the extraction harness and writes the outcome.
   *
   * Notes and the terminal job state are written in one transaction, so no job can be
   * terminal without its notes (docs/Jobs.md).
   */
  private async extract(job: ClaimedJob, startedAt: number): Promise<void> {
    if (!this.notes.constructor) throw new Error("notes service unavailable");

    // Segments first: Recap analyses the transcript, and speaker naming needs it too.
    let segments = await this.transcripts.findForCall(job.callId);
    if (segments.length === 0) {
      throw new Error("No transcript to extract from");
    }
    segments = await this.nameSpeakers(job, segments);

    const source = await this.chooseSource(job, segments);
    if (!source && !this.orchestrator.isConfigured()) {
      // Honest stop: a transcript exists, extraction cannot run, and the job says so rather than
      // reporting empty notes as a result.
      await this.jobs.transition(job.id, "FAILED", {
        failureReason: "llm_not_configured",
        failureMessage:
          "Analysis is not configured on this server. The transcript is still available.",
        lastError:
          "No extraction source: PyAI Recap unavailable and LLM_BASE_URL / LLM_API_KEY unset",
      });
      await this.events.append(job.id, "error", {
        code: "internal_error",
        message: "Extraction is not configured.",
      });
      this.logger.error(`Job ${job.id} cannot extract: no extraction source available`);
      return;
    }

    const outcome = await this.notes.extract({
      callId: job.callId,
      segments: segments.map((segment) => ({
        id: segment.id,
        index: segment.index,
        speaker: segment.speaker,
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text,
      })),
      sttModel: job.source === "FIXTURE" ? null : (job.mimeType ? "pyai-hear" : null),
      tokenBudget: job.tokenBudget,
      deadlineAt: job.deadlineAt,
      startedAt,
      source,
    });

    for (const section of ["objections", "intent", "nextSteps", "summary", "followUpEmail"]) {
      await this.events.append(job.id, "section", {
        section,
        status: outcome.notes.metadata.droppedSections.includes(section)
          ? "dropped"
          : "complete",
      });
    }

    await this.persist(job, outcome);

    await this.events.append(job.id, "terminal", {
      exitStatus: outcome.exitStatus,
      droppedClaims: outcome.notes.metadata.droppedClaims,
      droppedSections: outcome.notes.metadata.droppedSections,
    });
  }

  private async persist(
    job: ClaimedJob,
    outcome: { notes: CallNotes; exitStatus: JobExitStatus; tokensUsed: number },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.notesRepository.upsert(job.callId, outcome.notes, tx);
      await tx.job.update({
        where: { id: job.id },
        data: {
          state: outcome.exitStatus.toUpperCase() as JobState,
          tokensUsed: outcome.tokensUsed,
          heartbeatAt: new Date(),
          finishedAt: new Date(),
          failureReason:
            outcome.exitStatus === "shipped" ? null : outcome.exitStatus,
        },
      });
    });
  }

  /**
   * Replaces "Speaker 1" with a real name where the transcript proves one. Runs before
   * extraction so the notes say "Marcus" rather than "Speaker 2". Never fails the job:
   * a call with anonymous speakers is still a perfectly good call.
   */
  private async nameSpeakers(
    job: ClaimedJob,
    segments: TranscriptSegment[],
  ): Promise<TranscriptSegment[]> {
    if (!SpeakerNamingService.needsNaming(segments)) return segments;

    try {
      const result = await this.orchestrator.nameSpeakers(
        segments.map((s) => ({ speaker: s.speaker, text: s.text })),
      );
      if (!result.ok) return segments;

      const names = this.speakers.gate(result.value, segments);
      if (names.size === 0) return segments;

      await this.transcripts.renameSpeakers(job.callId, names);
      this.logger.log(
        `Named ${names.size} speaker(s): ${[...names.entries()]
          .map(([label, name]) => `${label}=${name}`)
          .join(", ")}`,
      );
      return this.speakers.apply(segments, names);
    } catch (error) {
      // Naming is an enhancement. Losing it must not lose the call.
      this.logger.warn(
        `Speaker naming skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
      return segments;
    }
  }

  private async loadFixtureTranscript(job: ClaimedJob): Promise<void> {
    if (!job.sourceRef) throw new Error("Fixture job has no fixture name");
    const result = await this.fixtures.load(job.sourceRef);
    const count = await this.transcripts.replaceForCall(
      job.callId,
      result.segments,
      result.durationMs,
    );
    await this.applyProposedNames(job, result.speakerNames ?? []);
    await this.events.append(job.id, "progress", {
      stage: "transcript",
      pct: 100,
      segments: count,
    });
  }

  /**
   * Picks where claims come from, in the order the product prefers them.
   *
   * 1. **PyAI Recap**, when it can analyse this call. Its findings are quoted, so they pass the same
   *    evidence gate as anything else, and they cost no second vendor — the one-API path.
   * 2. **Recap plus the model**, when `LLM_ENABLED=true`. Recap still wins any section it can
   *    evidence; the model fills what it cannot — next steps, intent without a buying signal, and
   *    the follow-up email.
   * 3. **A recorded extraction**, for a sample call with no provider at all (ADR-016).
   * 4. **The model alone**, which is what `undefined` means to `NotesService`.
   *
   * Returning `undefined` is not failure — it means "use the live orchestrator". The caller treats
   * it as failure only when the orchestrator is unconfigured too.
   */
  private async chooseSource(
    job: ClaimedJob,
    segments: TranscriptSegment[],
  ): Promise<ExtractionSource | undefined> {
    const llmEnabled = this.config.get<boolean>("LLM_ENABLED") === true;

    /*
     * Sample calls share one Recap key across runs.
     *
     * Recap is metered per call and the key carries a daily cap, so keying the cache by the row's
     * uuid would buy a fresh unit every time the same fixture is demoed — the transcript is
     * byte-identical, so the analysis would be too. A fixture keys on its name and hits the cache
     * from the second run onward; real audio keys on the call, because no two uploads are the same.
     */
    const recapKey =
      job.source === "FIXTURE" && job.sourceRef
        ? `opengong-${job.sourceRef}`
        : job.callId;

    /*
     * Roles are computed here, not inside the client, because whether they resolved changes what we
     * are allowed to believe about the response — and this is the last place that knows.
     *
     * Note the ordering above: `nameSpeakers` has already run, so `segment.speaker` may be `Marcus`
     * rather than `Rep`. Naming the speakers is what a reader wants and what breaks the role
     * heuristic, so a resolved-looking transcript is exactly when this is most likely to fail.
     */
    const utterances = RecapClient.toUtterances(segments);
    const rolesResolved = RecapClient.rolesResolved(utterances);
    if (!rolesResolved && this.recap.isConfigured()) {
      this.logger.warn(
        `Job ${job.id}: no speaker looks like our side, so Recap is analysing this call as if the ` +
          `buyer spoke every line. Buying signals will not be used for intent.`,
      );
    }

    const recapRecord = this.recap.isConfigured()
      ? await this.recap.analyse(recapKey, utterances).catch(() => null)
      : null;

    if (recapRecord) {
      const recapSource = new RecapExtractionSource(recapRecord, rolesResolved);
      if (llmEnabled && this.orchestrator.isConfigured()) {
        this.logger.log(`Job ${job.id}: PyAI Recap, with the model filling its gaps`);
        return new CompositeExtractionSource(recapSource, this.orchestrator);
      }
      this.logger.log(`Job ${job.id}: PyAI Recap only (LLM_ENABLED=false)`);
      return recapSource;
    }

    if (!this.orchestrator.isConfigured() && job.source === "FIXTURE" && job.sourceRef) {
      const replayed = await this.replay.load(job.sourceRef);
      if (replayed) {
        this.logger.warn(
          `Job ${job.id}: no provider reachable, replaying the recorded extraction for ${job.sourceRef}`,
        );
        return replayed;
      }
    }

    return undefined;
  }

  /**
   * Runs names the transcript source proposed through the evidence gate.
   *
   * A fixture ships role labels ("Prospect") because that is what the author knew before
   * reading the call back. The names are in the words — "Hey Marcus", "Hi, it's Nadia" —
   * and this is where they get applied, on exactly the same terms as a model's guess: the
   * quote has to resolve against the transcript and has to contain the name. So the
   * rehearsed demo exercises the real gate rather than a hand-written answer, and a
   * fixture cannot smuggle in an identity the call never states.
   *
   * Whatever fails the gate keeps its authored label, which is why a four-speaker call can
   * end up with two names and two roles. That mix is the honest outcome, not a bug.
   */
  private async applyProposedNames(
    job: ClaimedJob,
    proposed: SttSpeakerName[],
  ): Promise<void> {
    if (proposed.length === 0) return;

    const segments = await this.transcripts.findForCall(job.callId);
    const names = this.speakers.gate(proposed, segments);
    if (names.size === 0) return;

    await this.transcripts.renameSpeakers(job.callId, names);
    this.logger.log(
      `Named ${names.size} speaker(s) from the transcript source: ${[
        ...names.entries(),
      ]
        .map(([label, name]) => `${label}=${name}`)
        .join(", ")}`,
    );
  }

  /**
   * Downloads a URL-sourced call and stores it, so transcription sees the same shape as
   * an upload. Done here rather than at ingest because a download can take as long as an
   * upload, and an HTTP request must not wait for it.
   */
  private async fetchRemoteAudio(job: ClaimedJob): Promise<{
    storageKey: string;
    mimeType: string;
  }> {
    if (!job.sourceRef) throw new Error("URL job has no source URL");

    const fetched = await this.urls.fetchAudio(job.sourceRef);

    // Same rule as an upload: the bytes decide, not the URL or the Content-Type.
    const detected = detectAudioType(fetched.buffer);
    if (!detected) {
      throw new ProblemException(
        "unsupported_media_type",
        "That link is not a supported audio file (mp3, wav, m4a, mp4, webm).",
        `declared ${fetched.declaredType ?? "nothing"} at ${job.sourceRef}`,
      );
    }

    const extension = EXTENSION_BY_TYPE[detected] ?? "bin";
    const stored = await this.storage.put(fetched.buffer, extension);

    await this.prisma.call.update({
      where: { id: job.callId },
      data: {
        storageKey: stored.storageKey,
        mimeType: detected,
        sizeBytes: stored.sizeBytes,
        originalName: fetched.fileName,
      },
    });

    return { storageKey: stored.storageKey, mimeType: detected };
  }

  private async transcribe(job: ClaimedJob): Promise<void> {
    let storageKey = job.storageKey;
    let mimeType = job.mimeType;

    if (!storageKey && job.source === "URL") {
      const fetched = await this.fetchRemoteAudio(job);
      storageKey = fetched.storageKey;
      mimeType = fetched.mimeType;
    }

    if (!storageKey) throw new Error("Job has no stored audio");

    const result = await this.pyai.transcribe({
      path: this.storage.pathFor(storageKey),
      mimeType: mimeType ?? "audio/mpeg",
    });

    const maxDuration =
      this.config.get<number>("UPLOAD_MAX_DURATION_MS") ?? 7_200_000;
    if (result.durationMs > maxDuration) {
      // Duration is only knowable here, which is why the check lives at this stage
      // rather than at ingest (docs/API.md).
      throw new Error(
        `Recording is ${Math.round(result.durationMs / 60_000)} minutes, over the limit`,
      );
    }

    const count = await this.transcripts.replaceForCall(
      job.callId,
      result.segments,
      result.durationMs,
    );
    await this.events.append(job.id, "progress", {
      stage: "transcript",
      pct: 100,
      segments: count,
    });
    await this.jobs.transition(job.id, "EXTRACTING");
    await this.events.append(job.id, "state", {
      state: "extracting",
      at: new Date().toISOString(),
    });
  }
}
