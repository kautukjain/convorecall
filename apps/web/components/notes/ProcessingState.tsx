import { Check, Loader2 } from "lucide-react";
import type { JobStatus } from "@opengong/types";
import { Panel, PanelHeader } from "../ui/Panel";
import { SectionLabel } from "../ui/SectionLabel";
import { SkeletonEvidence, SkeletonText, SkeletonTranscript } from "../ui/Skeleton";

/**
 * The waiting screen. Two jobs: say which of the three stages is running, and promise the
 * shape of what is coming.
 *
 * A percentage would be a lie — transcription length is not known until it finishes — so
 * progress is expressed as named stages instead. The design system forbids a page-sized
 * spinner for exactly this reason: a spinner communicates duration it does not know.
 */
const STAGES: Array<{ state: JobStatus; label: string; detail: string }> = [
  { state: "queued", label: "Queued", detail: "Waiting for a worker" },
  {
    state: "transcribing",
    label: "Transcribing",
    detail: "Turning audio into timed segments",
  },
  {
    state: "extracting",
    label: "Finding claims",
    detail: "Matching each one back to the recording",
  },
];

export function ProcessingState({ state }: { state: JobStatus }) {
  const current = Math.max(
    0,
    STAGES.findIndex((stage) => stage.state === state),
  );

  return (
    <div className="space-y-10">
      <Panel>
        <PanelHeader title="Reading the call" />
        <div className="px-5 py-5">
          <ol className="space-y-0">
            {STAGES.map((stage, i) => {
              const done = i < current;
              const active = i === current;
              return (
                <li key={stage.state} className="flex gap-3">
                  {/* Marker column, with a hairline running between markers. */}
                  <div className="flex flex-col items-center">
                    <span
                      className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${
                        done
                          ? "border-brand-border bg-brand-surface text-brand"
                          : active
                            ? "border-border-strong bg-surface text-fg"
                            : "border-border bg-raised text-subtle"
                      }`}
                    >
                      {done ? (
                        <Check size={11} strokeWidth={2.5} aria-hidden />
                      ) : active ? (
                        <Loader2
                          size={11}
                          strokeWidth={2.5}
                          className="animate-spin"
                          aria-hidden
                        />
                      ) : (
                        <span className="size-1 rounded-full bg-current" aria-hidden />
                      )}
                    </span>
                    {i < STAGES.length - 1 && (
                      <span className="my-1 w-px flex-1 bg-border" aria-hidden />
                    )}
                  </div>

                  <div className={i < STAGES.length - 1 ? "pb-5" : ""}>
                    <p
                      className={`text-sm font-medium ${active ? "text-fg" : "text-muted"}`}
                      aria-current={active ? "step" : undefined}
                    >
                      {stage.label}
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-subtle">{stage.detail}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </Panel>

      {/* The shape of the result, so the page does not jump when it arrives. */}
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12">
        <div className="space-y-10">
          <section>
            <SectionLabel>Summary</SectionLabel>
            <SkeletonText lines={3} />
          </section>
          <section>
            <SectionLabel>Objections</SectionLabel>
            <div className="space-y-3">
              <SkeletonEvidence />
              <SkeletonEvidence />
            </div>
          </section>
        </div>
        <div>
          <SectionLabel>Transcript</SectionLabel>
          <Panel>
            <SkeletonTranscript rows={8} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
