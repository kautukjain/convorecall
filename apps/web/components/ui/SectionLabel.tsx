import type { ReactNode } from "react";

/**
 * A section heading, set as a tracked eyebrow above a hairline rule that runs to the edge
 * of the column. The rule is what makes the page scan as a document with parts, so the
 * heading itself can stay small instead of shouting for the same result.
 *
 * `count` is rendered when a section holds a countable list — a reader deciding whether
 * to read three objections or eleven should not have to count them.
 */
export function SectionLabel({
  children,
  count,
  action,
}: {
  children: ReactNode;
  count?: number;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <h2 className="label-eyebrow shrink-0">{children}</h2>
      {count !== undefined && (
        <span className="shrink-0 text-[0.6875rem] font-medium tabular-nums text-subtle">
          {count}
        </span>
      )}
      <span className="h-px min-w-4 flex-1 bg-border" aria-hidden />
      {action}
    </div>
  );
}
