import { BadgeCheck, CircleSlash, Timer, TriangleAlert } from "lucide-react";
import type { JobExitStatus } from "@opengong/types";

/**
 * `partial` is the expected common case on real audio (ADR-011). Styling it as a warning
 * would train users to distrust a working system, so it reads as ordinary — only genuine
 * failures take colour.
 *
 * `shipped` is the one status that takes pine: everything the model claimed was matched to
 * the recording. That is the promise of the product, so it is worth one hue.
 */
const STYLES: Record<
  JobExitStatus,
  { label: string; className: string; Icon: typeof BadgeCheck }
> = {
  shipped: {
    label: "Verified",
    className: "border-brand-border bg-brand-surface text-brand",
    Icon: BadgeCheck,
  },
  partial: {
    label: "Partial",
    className: "border-border bg-raised text-muted",
    Icon: CircleSlash,
  },
  deadline: {
    label: "Stopped at budget",
    className: "border-border bg-warn-bg text-warn",
    Icon: Timer,
  },
  failed: {
    label: "Failed",
    className: "border-danger-border bg-danger-bg text-danger",
    Icon: TriangleAlert,
  },
};

export function ExitBadge({
  status,
  droppedClaims,
}: {
  status: JobExitStatus;
  droppedClaims: number;
}) {
  const { label, className, Icon } = STYLES[status];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
      <span
        className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 font-medium ${className}`}
      >
        <Icon size={12} strokeWidth={2} aria-hidden />
        {label}
      </span>
      {droppedClaims > 0 && (
        <span
          className="text-subtle"
          title="These claims could not be matched to anything said on the call, so they were removed."
        >
          <span className="tabular-nums">{droppedClaims}</span> claim
          {droppedClaims === 1 ? "" : "s"} removed &mdash; not verifiable
        </span>
      )}
    </div>
  );
}
