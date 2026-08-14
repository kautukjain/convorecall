import type { JobExitStatus } from "@opengong/types";

export const ALL_SECTIONS = [
  "summary",
  "intent",
  "objections",
  "nextSteps",
  "followUpEmail",
] as const;

export type ExitInputs = {
  /** Sections that produced no usable output. */
  droppedSections: string[];
  /** Claims removed by the evidence gate. */
  droppedClaims: number;
  /** A wall-clock or token budget ran out before completion. */
  budgetExhausted: boolean;
  /** Nothing usable was produced, or an unrecoverable error occurred. */
  unrecoverable?: boolean;
};

/**
 * Exit status resolution (ADR-011). Ordered, first match wins, evaluated once.
 *
 * Pure so it can be exhaustively tested — this is the decision users see, and it must
 * not vary between two runs of the same job.
 */
export function resolveExitStatus(inputs: ExitInputs): JobExitStatus {
  const survived = ALL_SECTIONS.length - inputs.droppedSections.length;

  // 1. Budget wins over everything: "we stopped on purpose" is not a failure, and
  //    whatever was produced is still kept.
  if (inputs.budgetExhausted) return "deadline";

  // 2. Nothing usable.
  if (inputs.unrecoverable || survived === 0) return "failed";

  // 3. Something survived, but something was lost.
  if (inputs.droppedSections.length > 0 || inputs.droppedClaims > 0) {
    return "partial";
  }

  // 4. Everything present, nothing dropped. A strict bar, deliberately.
  return "shipped";
}
