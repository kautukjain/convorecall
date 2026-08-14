import { z } from "zod";

export const JobExitStatusSchema = z.enum([
  "shipped",
  "partial",
  "failed",
  "deadline",
]);

export const JobStatusSchema = z.enum([
  "queued",
  "transcribing",
  "extracting",
  "shipped",
  "partial",
  "failed",
  "deadline",
]);

export const TranscriptSegmentSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().nonnegative(),
  speaker: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string().min(1),
});

/**
 * Speaker naming (see docs/Evidence-System.md). The supplier — a model at runtime, or a
 * fixture author — gives a label, a name, and a quote. Never a segment id. The quote is
 * what gets verified.
 */
export const SpeakerNameSchema = z.object({
  label: z.string().min(1),
  name: z.string().min(1).max(60),
  quote: z.string().min(1),
});

export const TranscriptSchema = z.object({
  callId: z.string().min(1),
  speakers: z.array(z.string()),
  durationMs: z.number().int().nonnegative().optional(),
  segments: z.array(TranscriptSegmentSchema).min(1),
  /**
   * Optional, and held to the same bar as a model's guess: an authored fixture may state
   * who a speaker is, but only by quoting the line where the call says so. A fixture that
   * simply asserts "Speaker 2 is Marcus" is the fabrication this product exists to refuse,
   * so it goes through the same gate (docs/Evidence-System.md).
   */
  speakerNames: z.array(SpeakerNameSchema).optional(),
});

/**
 * What an extractor is allowed to return (ADR-009).
 *
 * Deliberately has no position fields. If a model emits them anyway they are stripped
 * here rather than merged, so a fabricated line number cannot reach the matcher.
 */
export const ClaimCandidateSchema = z.object({
  claim: z.string().min(1),
  quote: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
});

/** A claim after the matcher has resolved it. */
export const EvidenceSchema = ClaimCandidateSchema.extend({
  segmentIds: z.array(z.string().min(1)).min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  speaker: z.string().min(1),
});

export const NotesMetadataSchema = z.object({
  exitStatus: JobExitStatusSchema,
  droppedClaims: z.number().int().nonnegative(),
  droppedSections: z.array(z.string()),
  promptVersion: z.string().min(1),
  sttModel: z.string().nullable(),
  llmModel: z.string().min(1),
  tokensUsed: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  generatedAt: z.string().min(1),
});

export const UncitedNotesSchema = z.object({
  source: z.string().min(1),
  actionItems: z.array(
    z.object({
      task: z.string().min(1),
      owner: z.string().optional(),
      due: z.string().optional(),
    }),
  ),
  nextSteps: z.string().optional(),
  keyDecisions: z.array(z.string().min(1)).optional(),
});

export const CallNotesSchema = z.object({
  callId: z.string().min(1),
  exitStatus: JobExitStatusSchema,
  summary: z.string(),
  /**
   * Nullable: a gate that kept no intent claim has none to report, and must not invent a blank one.
   *
   * The `preprocess` is a compatibility shim, not part of the contract. Earlier builds persisted a
   * missing intent as an `Evidence` with an empty claim and no segment ids, and notes are stored
   * artifacts — every read path validates the row it loaded, so those rows would answer
   * `internal_error` forever otherwise. Blank in, null out; a genuinely malformed intent still fails.
   */
  intent: z.preprocess(
    (value) =>
      value &&
      typeof value === "object" &&
      !(value as { claim?: unknown }).claim
        ? null
        : value,
    EvidenceSchema.nullable(),
  ),
  objections: z.array(EvidenceSchema),
  nextSteps: z.array(EvidenceSchema),
  followUpEmail: z.string(),
  /** Separately labelled, unevidenced vendor output (ADR-002). Never part of a shipped claim. */
  uncited: UncitedNotesSchema.optional(),
  metadata: NotesMetadataSchema,
});

/** Per-section extractor output, before the evidence gate runs. */
export const ExtractedClaimsSchema = z.object({
  claims: z.array(ClaimCandidateSchema),
});

export type ClaimCandidateInput = z.infer<typeof ClaimCandidateSchema>;
export type EvidenceInput = z.infer<typeof EvidenceSchema>;
export type CallNotesInput = z.infer<typeof CallNotesSchema>;
export type TranscriptInput = z.infer<typeof TranscriptSchema>;

/** What the naming extractor returns. `SpeakerNameSchema` is declared above. */
export const SpeakerNamesSchema = z.object({
  speakers: z.array(SpeakerNameSchema),
});

export type SpeakerNameInput = z.infer<typeof SpeakerNameSchema>;

/**
 * A recorded extraction for a sample call, replayed when no model is configured
 * (`sample-data/extraction/`). Written by `scripts/record-extraction.ts`.
 *
 * Holds the *ungated* claim candidates — claim and quote, no positions — because that is
 * what a model returns and therefore what the evidence gate must still be given something
 * to reject. A recording of finished evidence would be a recording of the gate's answer
 * rather than of its input.
 *
 * `recordedFrom` is not decoration: a replay that cannot say which model and which day it
 * came from is indistinguishable from a hand-written result.
 */
export const RecordedExtractionSchema = z.object({
  callId: z.string().min(1),
  recordedFrom: z.object({
    model: z.string().min(1),
    at: z.string().min(1),
    promptVersion: z.string().min(1).optional(),
  }),
  sections: z.object({
    objections: z.array(ClaimCandidateSchema),
    intent: z.array(ClaimCandidateSchema),
    nextSteps: z.array(ClaimCandidateSchema),
    summary: z.string(),
    followUpEmail: z.string(),
  }),
});

export type RecordedExtractionInput = z.infer<typeof RecordedExtractionSchema>;
