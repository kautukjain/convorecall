"use client";

import { FileText, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CallNotes, Evidence } from "@convorecall/types";
import {
  ApiError,
  api,
  isTerminal,
  type CallSummary,
  type Transcript,
} from "../../../lib/api";
import { CallAudio } from "../../../components/notes/CallAudio";
import { EvidenceCard } from "../../../components/notes/EvidenceCard";
import { ExitBadge } from "../../../components/notes/ExitBadge";
import { ProcessingState } from "../../../components/notes/ProcessingState";
import { ShareAndExport } from "../../../components/notes/ShareAndExport";
import { TranscriptPanel } from "../../../components/notes/TranscriptPanel";
import { UncitedDecisions } from "../../../components/notes/UncitedDecisions";
import { UncitedItems } from "../../../components/notes/UncitedItems";
import { CopyButton } from "../../../components/ui/CopyButton";
import { Panel, PanelHeader } from "../../../components/ui/Panel";
import { SectionLabel } from "../../../components/ui/SectionLabel";

export function CallView({ id }: { id: string }) {
  const [call, setCall] = useState<CallSummary | null>(null);
  const [notes, setNotes] = useState<CallNotes | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  /**
   * One click, two jumps: the transcript scrolls to the cited line and the recording seeks to
   * the moment it was said. Playback is best-effort — a browser may refuse `play()` before the
   * user has interacted with the page, and a refused promise must not break the highlight,
   * which is the part that always works.
   */
  const select = useCallback((evidence: Evidence) => {
    setHighlighted(evidence.segmentIds);

    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    // Clamp: a transcript can outrun its recording, and seeking past the end just stops it.
    audio.currentTime = Math.min(evidence.startMs / 1000, Math.max(0, audio.duration - 0.1));
    void audio.play().catch(() => undefined);
  }, []);

  /**
   * Which line the recording is on, from its position.
   *
   * The last segment that has started, rather than the one strictly containing the playhead:
   * there are real pauses between turns, and blanking the highlight in every gap would make it
   * flicker several times a minute.
   *
   * `timeupdate` fires about four times a second, so this only calls `setPlayingId` when the
   * line actually changes — otherwise every tick would re-render the whole transcript.
   */
  const followAudio = useCallback(
    (seconds: number) => {
      const segments = transcript?.segments;
      if (!segments?.length) return;

      const atMs = seconds * 1000;
      // Binary search: segments are ordered, and a two-hour call is thousands of rows.
      let low = 0;
      let high = segments.length - 1;
      let found = -1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if ((segments[mid]?.startMs ?? 0) <= atMs) {
          found = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      const id = found >= 0 ? (segments[found]?.id ?? null) : null;
      setPlayingId((current) => (current === id ? current : id));
    },
    [transcript],
  );

  const load = useCallback(async () => {
    try {
      const summary = await api.getCall(id);
      setCall(summary);

      if (!isTerminal(summary.state)) return false;

      // Transcript may exist even when extraction failed; ask for both independently
      // so one missing piece does not blank the page.
      try {
        setTranscript(await api.getTranscript(id));
      } catch {
        /* not ready */
      }
      try {
        setNotes(await api.getNotes(id));
      } catch (cause) {
        if (cause instanceof ApiError && cause.problem.code !== "notes_not_ready") {
          setError(cause.problem.detail);
        }
      }
      return true;
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.problem.detail : "Could not reach the API.",
      );
      return true;
    }
  }, [id]);

  useEffect(() => {
    let stop = false;
    void (async () => {
      if (await load()) return;
      // SSE is the fast path; polling is the guarantee (docs/Jobs.md).
      const source = new EventSource(api.eventsUrl(id));
      const refresh = () => void load().then((done) => done && source.close());
      source.addEventListener("state", refresh);
      source.addEventListener("terminal", refresh);
      source.addEventListener("error", refresh);
      const timer = setInterval(() => {
        if (stop) return;
        void load().then((done) => {
          if (done) {
            clearInterval(timer);
            source.close();
          }
        });
      }, 3000);
      return () => {
        stop = true;
        clearInterval(timer);
        source.close();
      };
    })();
    return () => {
      stop = true;
    };
  }, [id, load]);

  if (error) {
    return (
      <Panel className="border-danger-border bg-danger-bg">
        <div className="flex gap-3 px-5 py-5">
          <TriangleAlert
            size={16}
            strokeWidth={2}
            className="mt-0.5 shrink-0 text-danger"
            aria-hidden
          />
          <div>
            <h2 className="text-sm font-medium text-danger">Something went wrong</h2>
            <p className="mt-1 text-sm leading-6 text-muted">{error}</p>
          </div>
        </div>
      </Panel>
    );
  }

  if (!call || !isTerminal(call.state)) {
    return <ProcessingState state={call?.state ?? "queued"} />;
  }

  if (!notes) {
    const failed = call.state === "failed";
    return (
      <div className="space-y-8">
        <Panel>
          <PanelHeader
            title={failed ? "This call could not be processed" : "No notes for this call"}
            icon={<TriangleAlert size={14} strokeWidth={2} aria-hidden />}
          />
          <div className="px-5 py-5">
            {/* The reason, in plain words. "Failed" alone gives nobody anything to do. */}
            <p className="text-sm leading-6 text-fg">
              {call.failure?.message ?? `The job ended as ${call.state}.`}
            </p>
            <p className="mt-2 text-sm leading-6 text-subtle">
              {transcript
                ? "The transcript below is still available."
                : "No transcript was produced."}
            </p>
          </div>
        </Panel>

        {transcript && (
          <section>
            <SectionLabel count={transcript.segments.length}>Transcript</SectionLabel>
            <Panel>
              <TranscriptPanel segments={transcript.segments} highlighted={[]} />
            </Panel>
          </section>
        )}
      </div>
    );
  }

  const sections = [
    { title: "Objections", items: notes.objections },
    { title: "Next steps", items: notes.nextSteps },
  ];

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-5 border-b border-border pb-6">
        <div>
          <h1 className="text-display text-3xl text-fg">Deal notes</h1>
          <p className="mt-1.5 text-sm leading-6 text-muted">
            Every claim points at the moment it came from. Click one to hear where.
          </p>
          <div className="mt-3">
            <ExitBadge
              status={notes.exitStatus}
              droppedClaims={notes.metadata.droppedClaims}
            />
          </div>
        </div>
        <ShareAndExport callId={id} />
      </header>

      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12">
        <div className="space-y-10">
          {notes.summary && (
            <section>
              <SectionLabel>Summary</SectionLabel>
              {/*
                The lede, in the document voice. Steps down on a phone: at 18px with 32px
                leading this paragraph alone fills a 390px screen, which buries the claims
                it is meant to introduce.
              */}
              <p className="font-serif text-base leading-7 text-fg sm:text-lg sm:leading-8">
                {notes.summary}
              </p>
            </section>
          )}

          {notes.intent?.claim && (
            <section>
              <SectionLabel>Intent</SectionLabel>
              <EvidenceCard
                evidence={notes.intent}
                active={highlighted[0] === notes.intent.segmentIds[0]}
                onSelect={select}
              />
            </section>
          )}

          {/*
            What the call settled. High on the page for the same reason Recap puts it near the top of
            its own dashboard: it is the shortest answer to "what happened", and it reads naturally
            before the objections that were raised against it.
          */}
          {(notes.uncited?.keyDecisions?.length ?? 0) > 0 && notes.uncited && (
            <section>
              <SectionLabel count={notes.uncited.keyDecisions?.length}>Decisions</SectionLabel>
              <UncitedDecisions notes={notes.uncited} />
            </section>
          )}

          {sections.map((section) => {
            /*
             * Action items belong under "Next steps", not in a section of their own.
             *
             * They were briefly separated because our data model separates them — evidenced claims
             * carry a citation, Recap's action items do not — but that is a storage distinction, and
             * letting it drive the page produced "Next steps 0" sitting above three next steps.
             * A reader wants the section they came for; the tiers inside it carry the difference.
             */
            const uncited =
              section.title === "Next steps" ? notes.uncited : undefined;
            const uncitedItems = uncited?.actionItems ?? [];
            const total = section.items.length + uncitedItems.length;

            return (
              <section key={section.title}>
                <SectionLabel count={total}>{section.title}</SectionLabel>

                {total === 0 ? (
                  <p className="rounded-md border border-dashed border-border bg-raised px-4 py-3.5 text-sm leading-6 text-subtle">
                    {/*
                      Claims rejected by the gate and a section that produced nothing are different
                      outcomes, and they used to share one sentence that asserted verification had
                      been attempted and failed.
                    */}
                    {notes.metadata.droppedClaims > 0
                      ? "Nothing here resolved to a moment in the recording."
                      : "Nothing was produced for this section."}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {section.items.map((evidence, i) => (
                      <EvidenceCard
                        key={`${section.title}-${i}`}
                        evidence={evidence}
                        active={
                          highlighted.length > 0 &&
                          highlighted[0] === evidence.segmentIds[0]
                        }
                        onSelect={select}
                      />
                    ))}

                    {uncited && uncitedItems.length > 0 && (
                      <UncitedItems notes={uncited} />
                    )}
                  </div>
                )}
              </section>
            );
          })}

          {notes.followUpEmail && (
            <section>
              <SectionLabel>Follow-up email</SectionLabel>
              <Panel>
                <PanelHeader
                  title="Draft"
                  icon={<FileText size={14} strokeWidth={2} aria-hidden />}
                  action={<CopyButton text={notes.followUpEmail} />}
                />
                <pre className="whitespace-pre-wrap px-4 py-4 font-serif text-[0.9375rem] leading-7 text-fg">
                  {notes.followUpEmail}
                </pre>
                {/*
                  The draft is the one output likely to reach a customer, so where it came from is
                  worth saying. When Recap composed it, its action items were never gated — they
                  carry no quote to test — so the draft asserts commitments the gate never checked.
                  Disclosed rather than hidden; a human sends it either way.
                */}
                {notes.metadata.llmModel.startsWith("pyai-recap") &&
                  (notes.uncited?.actionItems.length ?? 0) > 0 && (
                    <p className="border-t border-border px-4 py-2.5 text-[0.6875rem] leading-4 text-subtle">
                      Assembled from {notes.uncited?.source} — the next steps it lists carry no
                      quote, so check them before sending.
                    </p>
                  )}
              </Panel>
            </section>
          )}
        </div>

        {/* Sticky so the cited line stays beside the claim you clicked. */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <SectionLabel count={transcript?.segments.length}>Transcript</SectionLabel>
          <Panel>
            <PanelHeader
              title="Recording"
              meta={
                transcript?.speakers.length
                  ? `${transcript.speakers.length} speakers`
                  : undefined
              }
            />
            {/*
              Above the transcript, inside the same panel: the recording and the words are one
              object, and clicking a claim drives both.
            */}
            <CallAudio
              ref={audioRef}
              callId={id}
              transcriptEndMs={transcript?.segments.at(-1)?.endMs ?? 0}
              onTime={followAudio}
            />

            <TranscriptPanel
              segments={transcript?.segments ?? []}
              highlighted={highlighted}
              playingId={playingId}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
