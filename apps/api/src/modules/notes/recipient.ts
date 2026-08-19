import type { Evidence } from "@convorecall/types";

/**
 * Composes the greeting on a follow-up draft.
 *
 * The model is told not to write names at all (`DERIVED_PROMPTS.followUpEmail`), because a
 * name it was not given is a name it invented, and a draft is one paste away from a
 * customer. So the greeting is assembled here from the speaker the evidence gate resolved —
 * the same provenance as `segmentIds`, derived by the matcher rather than asserted by a
 * model.
 *
 * Everything unknown is omitted rather than filled in. An unsigned, ungreeted draft reads as
 * a draft; "Dear [Prospect Name]" reads as a product that shipped without being looked at.
 */

/**
 * Labels that identify a seat rather than a person. Diarization emits `Speaker 2`; authored
 * fixtures and real transcripts use role words. "Dear Prospect," is worse than no greeting.
 *
 * A heuristic, and worth naming as one: a real person called "Support" would be skipped, and
 * a role word not on this list would be greeted. It fails toward omission, which is the safe
 * direction — the cost is a missing greeting, not a wrong name in a customer's inbox.
 */
const ROLE_LABELS = new Set(
  [
    "rep",
    "prospect",
    "customer",
    "client",
    "buyer",
    "seller",
    "support",
    "security",
    "procurement",
    "finance",
    "legal",
    "sales",
    "vp sales",
    "account manager",
    "unknown",
  ].map((label) => label.toLowerCase()),
);

/** Whether a speaker label names a person we could address. */
export function isPersonName(speaker: string): boolean {
  const trimmed = speaker.trim();
  if (trimmed.length === 0) return false;
  // Positional labels from diarization: separated voices, no identity.
  if (/^speaker\s*\d+$/i.test(trimmed)) return false;
  return !ROLE_LABELS.has(trimmed.toLowerCase());
}

/**
 * The one person the draft is written to, or null.
 *
 * Taken from the claims *about* the counterparty — their intent and their objections. Next
 * steps are excluded because those are usually ours to do, so their speaker is the sender.
 *
 * More than one distinct counterparty means there is no single recipient, which is the
 * ordinary case on a multi-stakeholder call. Addressing one of four people by name would be
 * a guess dressed as a fact, so the greeting is dropped instead.
 */
export function deriveRecipient(
  intent: Evidence | null,
  objections: Evidence[],
): string | null {
  const speakers = new Set(
    [...(intent ? [intent] : []), ...objections]
      .filter((evidence) => evidence.claim && evidence.speaker)
      .map((evidence) => evidence.speaker.trim()),
  );

  if (speakers.size !== 1) return null;
  const [only] = [...speakers];
  return only && isPersonName(only) ? only : null;
}

/** The draft, greeted where we can prove who it is to. Body is left exactly as written. */
export function composeEmail(
  body: string,
  intent: Evidence | null,
  objections: Evidence[],
): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) return "";

  const recipient = deriveRecipient(intent, objections);
  return recipient ? `Dear ${recipient},\n\n${trimmed}` : trimmed;
}
