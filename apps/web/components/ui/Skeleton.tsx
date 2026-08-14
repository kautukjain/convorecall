/**
 * Loading placeholders. The design system forbids a large spinner for page loads, because
 * a spinner says "wait" while a skeleton says "here is what is coming" — and on this
 * screen what is coming has a shape worth promising.
 *
 * Widths vary per line so a paragraph placeholder reads as prose rather than as a bar
 * chart. They are deterministic, not random, so the placeholder does not reflow.
 */
const LINE_WIDTHS = ["100%", "94%", "97%", "72%"];

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2.5" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="skeleton h-3"
          style={{ width: LINE_WIDTHS[i % LINE_WIDTHS.length] }}
        />
      ))}
    </div>
  );
}

/** A placeholder shaped like an EvidenceCard: claim, quote rail, metadata row. */
export function SkeletonEvidence() {
  return (
    <div className="rounded-md border border-border bg-surface px-4 py-3.5" aria-hidden>
      <div className="skeleton h-3 w-[88%]" />
      <div className="mt-3 border-l-2 border-border pl-3">
        <div className="skeleton h-3 w-[76%]" />
        <div className="skeleton mt-2 h-3 w-[54%]" />
      </div>
      <div className="mt-3.5 flex items-center gap-2">
        <div className="skeleton size-5 rounded-full" />
        <div className="skeleton h-2.5 w-20" />
        <div className="skeleton h-2.5 w-10" />
      </div>
    </div>
  );
}

/** A placeholder shaped like the transcript: timestamp gutter, then a line of speech. */
export function SkeletonTranscript({ rows = 7 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-3" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-3">
          <div className="skeleton h-3 w-16 shrink-0" />
          <div
            className="skeleton h-3 flex-1"
            style={{ maxWidth: LINE_WIDTHS[i % LINE_WIDTHS.length] }}
          />
        </div>
      ))}
    </div>
  );
}
