import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ProblemException } from "../../../common/problem.js";
import {
  backoff,
  describeNetworkError,
  isNetworkFailure,
  isRetryable,
  isRetryableJobError,
} from "../../../common/retry.js";
import {
  UNKNOWN_SPEAKER_PREFIX,
  type SttProvider,
  type SttRequest,
  type SttResult,
  type SttSegment,
} from "../stt.types.js";

/** Thrown for conditions the transport-retry class is allowed to retry (ADR-007). */
class TransientSttError extends Error {}

/** Async transcription job result (`GET /v1/transcription/jobs/{id}`). */
export type TranscriptionJobResult = {
  text?: string;
  speakers?: number;
  audio_seconds?: number;
  segments?: Array<{
    id?: number;
    start?: number;
    end?: number;
    text?: string;
    speaker?: string;
  }>;
};

type TranscriptionJob = {
  job_id?: string;
  status?: "queued" | "running" | "completed" | "failed" | "cancelled";
  result?: TranscriptionJobResult;
  result_url?: string;
  error?: string;
};

/**
 * PyAI speech-to-text (ADR-003).
 *
 * Uses the **async job API**, not `POST /v1/audio/transcriptions`. The synchronous
 * endpoint returns only `{text, duration}` — no timestamps and no speakers — which
 * cannot support the evidence system. Diarized, timestamped segments are only available
 * from `POST /v1/transcription/jobs` with `diarize=true`. Verified by spike 2a.
 *
 * The polling this requires is why the worker owns transcription: an HTTP request could
 * not wait for it, and the job row already exists to hold the state.
 */
@Injectable()
export class PyAiSttProvider implements SttProvider {
  readonly id = "pyai";
  private readonly logger = new Logger(PyAiSttProvider.name);

  constructor(private readonly config: ConfigService) {}

  private baseUrl(): string {
    const raw = this.config.get<string>("PYAI_BASE_URL");
    if (!raw) {
      throw new ProblemException(
        "internal_error",
        "Transcription is not configured.",
        "PYAI_BASE_URL is unset",
      );
    }
    return raw.replace(/\/+$/, "");
  }

  private authHeader(): Record<string, string> {
    const key = this.config.get<string>("PYAI_API_KEY");
    if (!key) {
      throw new ProblemException(
        "internal_error",
        "Transcription is not configured.",
        "PYAI_API_KEY is unset",
      );
    }
    return { authorization: `Bearer ${key}` };
  }

  /**
   * Transport retry for speech-to-text (ADR-007).
   *
   * This class was documented in docs/Harness.md from the start and implemented only in
   * the LLM client, so a 5xx from the transcription engine failed the job on the first
   * attempt. Large uploads fail this way intermittently at the provider's gateway.
   */
  async transcribe(request: SttRequest): Promise<SttResult> {
    const maxAttempts = this.config.get<number>("TRANSPORT_RETRY_MAX") ?? 3;
    let last = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.attemptTranscribe(request);
      } catch (error) {
        if (!(error instanceof TransientSttError)) throw error;
        last = error.message;
        if (attempt >= maxAttempts) break;
        this.logger.warn(
          `STT attempt ${attempt}/${maxAttempts} failed (${last}); retrying`,
        );
        await backoff(attempt);
      }
    }

    throw new ProblemException(
      "internal_error",
      "Transcription failed after several attempts. Long recordings are the usual cause — " +
        "try a shorter clip.",
      `${this.id} exhausted ${maxAttempts} attempts: ${last}`,
    );
  }

  private async attemptTranscribe(request: SttRequest): Promise<SttResult> {
    const base = this.baseUrl();
    const headers = this.authHeader();
    const model = this.config.get<string>("PYAI_STT_MODEL") ?? "pyai-hear";
    const timeoutMs =
      this.config.get<number>("STT_REQUEST_TIMEOUT_MS") ?? 600_000;
    const deadline = Date.now() + timeoutMs;

    const audio = await readFile(request.path);
    const body = new FormData();
    body.set(
      "audio",
      new Blob([audio], { type: request.mimeType }),
      basename(request.path),
    );
    body.set("model", model);
    // Without diarize=true there are no speaker labels, and without speaker labels a
    // claim cannot be attributed (docs/Evidence-System.md).
    body.set("diarize", "true");
    body.set("language", "en");

    // The upload is part of the work, so the allowance scales with the payload rather
    // than sitting at a flat 120s that a 10 MB file on a slow link will blow through.
    const uploadAllowance = Math.min(
      timeoutMs,
      120_000 + Math.ceil(audio.byteLength / 1_048_576) * 15_000,
    );

    const created = await fetch(`${base}/transcription/jobs`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(uploadAllowance),
    }).catch((error: unknown) => {
      if (isNetworkFailure(error)) {
        throw new TransientSttError(`create: ${describeNetworkError(error)}`);
      }
      throw error;
    });

    if (!created.ok) {
      const body = (await created.text()).slice(0, 300);
      if (isRetryable(created.status, body)) {
        throw new TransientSttError(`create ${created.status}: ${body}`);
      }
      // Quota is the one failure a user can act on immediately, and backoff never
      // fixes it — say so instead of a generic failure.
      const quota = /daily_cap_exceeded|insufficient_quota|sandbox_limit_reached/.test(body);
      // 413 is the provider's hard ceiling on the request body. Uncompressed wav is the
      // usual culprit — the same call as mp3 is roughly a tenth of the size.
      const tooLarge = created.status === 413 || /entity too large/i.test(body);
      throw new ProblemException(
        tooLarge ? "upload_too_large" : "internal_error",
        quota
          ? "The transcription service has hit its usage limit for today. It resets at 00:00 UTC."
          : tooLarge
            ? "This recording is too large for the transcription service. Convert it to mp3 or use a shorter clip — uncompressed wav is usually the cause."
            : "Transcription failed.",
        `${this.id} create returned ${created.status}: ${body}`,
      );
    }

    const job = (await created.json()) as TranscriptionJob;
    if (!job.job_id) {
      throw new ProblemException(
        "internal_error",
        "Transcription failed.",
        `${this.id} returned no job_id`,
      );
    }

    const result = await this.poll(base, headers, job.job_id, deadline);
    return this.normalize(result, model);
  }

  private async poll(
    base: string,
    headers: Record<string, string>,
    jobId: string,
    deadline: number,
  ): Promise<TranscriptionJobResult> {
    let waitMs = 1_000;

    while (Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, waitMs));
      waitMs = Math.min(waitMs * 1.5, 10_000);

      const response = await fetch(`${base}/transcription/jobs/${jobId}`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(30_000),
      }).catch((error: unknown) => {
        // A dropped poll is not a failed job; keep polling until the deadline.
        if (isNetworkFailure(error)) return null;
        throw error;
      });
      if (!response || !response.ok) continue;

      const job = (await response.json()) as TranscriptionJob;

      if (job.status === "completed") {
        if (job.result) return job.result;
        if (job.result_url) {
          // Large results are offloaded rather than inlined.
          const offloaded = await fetch(job.result_url, {
            signal: AbortSignal.timeout(60_000),
          });
          if (!offloaded.ok) {
            throw new ProblemException(
              "internal_error",
              "Transcription failed.",
              `${this.id} result_url returned ${offloaded.status}`,
            );
          }
          return (await offloaded.json()) as TranscriptionJobResult;
        }
        throw new ProblemException(
          "internal_error",
          "Transcription failed.",
          `${this.id} completed with neither result nor result_url`,
        );
      }

      if (job.status === "failed" || job.status === "cancelled") {
        if (isRetryableJobError(job.error)) {
          throw new TransientSttError(`job ${job.status}: ${job.error}`);
        }
        throw new ProblemException(
          "internal_error",
          "Transcription failed.",
          `${this.id} job ${job.status}: ${job.error ?? "no detail"}`,
        );
      }
    }

    // A timeout here is a budget outcome, and the worker maps it accordingly.
    throw new ProblemException(
      "internal_error",
      "Transcription timed out.",
      `${this.id} job ${jobId} did not complete before the STT deadline`,
    );
  }

  /** Where every provider quirk is absorbed. Seconds in, milliseconds out. */
  normalize(payload: TranscriptionJobResult, model: string): SttResult {
    const raw = payload.segments ?? [];
    if (raw.length === 0) {
      throw new ProblemException(
        "internal_error",
        "Transcription returned no segments.",
        `${this.id} produced no diarized segments`,
      );
    }

    // Provider speaker ids (`speaker_1`) become stable positional labels in order of
    // first appearance, so a transcript never leaks vendor identifiers.
    const labels = new Map<string, string>();
    const labelFor = (speaker: string | undefined): string => {
      const key = speaker ?? "__none__";
      if (!labels.has(key)) {
        labels.set(key, `${UNKNOWN_SPEAKER_PREFIX} ${labels.size + 1}`);
      }
      return labels.get(key) ?? `${UNKNOWN_SPEAKER_PREFIX} 1`;
    };

    const segments: SttSegment[] = raw
      .map((segment) => ({
        speaker: labelFor(segment.speaker),
        startMs: Math.round((segment.start ?? 0) * 1000),
        endMs: Math.round((segment.end ?? segment.start ?? 0) * 1000),
        text: (segment.text ?? "").trim(),
      }))
      .filter((segment) => segment.text.length > 0);

    if (segments.length === 0) {
      throw new ProblemException(
        "internal_error",
        "Transcription returned no usable text.",
        `${this.id} produced ${raw.length} empty segments`,
      );
    }

    const durationMs = payload.audio_seconds
      ? Math.round(payload.audio_seconds * 1000)
      : segments.reduce((max, s) => Math.max(max, s.endMs), 0);

    this.logger.log(
      `Transcribed ${segments.length} segments, ${labels.size} speaker(s) via ${model}`,
    );

    return { segments, durationMs, model };
  }
}
