import type { CallSource, JobState } from "@prisma/client";
import type { CallWithJob } from "./calls.repository.js";

/**
 * Database enums are uppercase; the wire contract in docs/API.md is lowercase.
 * Mapping lives here so no controller or service hand-rolls a `.toLowerCase()`.
 */
export const STATE_TO_WIRE = {
  QUEUED: "queued",
  TRANSCRIBING: "transcribing",
  EXTRACTING: "extracting",
  SHIPPED: "shipped",
  PARTIAL: "partial",
  FAILED: "failed",
  DEADLINE: "deadline",
} as const satisfies Record<JobState, string>;

export const SOURCE_TO_WIRE = {
  UPLOAD: "upload",
  URL: "url",
  FIXTURE: "fixture",
} as const satisfies Record<CallSource, string>;

/** Reasons set by the sweeps, which have no ProblemException to draw a message from. */
const FALLBACK_FAILURE: Record<string, string> = {
  orphaned: "Processing was interrupted and could not be resumed.",
  wall_clock_exhausted:
    "Analysis ran out of time. Anything produced before that is shown.",
};

const TERMINAL_STATES: JobState[] = [
  "SHIPPED",
  "PARTIAL",
  "FAILED",
  "DEADLINE",
];

export type CreatedCallResponse = {
  id: string;
  state: string;
  source: string;
  createdAt: string;
  events: string;
};

export type CallResponse = {
  id: string;
  state: string;
  source: string;
  durationMs: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  exitStatus: string | null;
  budget: {
    tokensUsed: number;
    tokenBudget: number;
    deadlineAt: string;
  } | null;
  /** Client-safe explanation of a non-success outcome. Never operator detail. */
  failure: { reason: string; message: string } | null;
};

export function toCreatedResponse(call: CallWithJob): CreatedCallResponse {
  return {
    id: call.id,
    state: STATE_TO_WIRE[call.job?.state ?? "QUEUED"],
    source: SOURCE_TO_WIRE[call.source],
    createdAt: call.createdAt.toISOString(),
    events: `/api/v1/calls/${call.id}/events`,
  };
}

export function toCallResponse(call: CallWithJob): CallResponse {
  const job = call.job;
  const state = job?.state ?? "QUEUED";

  return {
    id: call.id,
    state: STATE_TO_WIRE[state],
    source: SOURCE_TO_WIRE[call.source],
    durationMs: call.durationMs,
    createdAt: call.createdAt.toISOString(),
    startedAt: job?.startedAt?.toISOString() ?? null,
    finishedAt: job?.finishedAt?.toISOString() ?? null,
    // Non-null only in a terminal state (docs/API.md).
    exitStatus: TERMINAL_STATES.includes(state) ? STATE_TO_WIRE[state] : null,
    budget: job
      ? {
          tokensUsed: job.tokensUsed,
          tokenBudget: job.tokenBudget,
          deadlineAt: job.deadlineAt.toISOString(),
        }
      : null,
    failure:
      job?.failureReason && state !== "SHIPPED"
        ? {
            reason: job.failureReason,
            message: job.failureMessage ?? FALLBACK_FAILURE[job.failureReason] ??
              "This call could not be processed.",
          }
        : null,
  };
}
