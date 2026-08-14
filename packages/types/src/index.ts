export type JobExitStatus = "shipped" | "partial" | "failed" | "deadline";

export type JobStatus =
  | "queued"
  | "transcribing"
  | "extracting"
  | JobExitStatus;

export type TranscriptSegment = {
  id: string;
  index: number;
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
};

/**
 * What an extractor is allowed to produce (ADR-009).
 *
 * The model supplies a claim and the words it believes support it — nothing else.
 * Position, timing, and speaker are derived by the matcher, so a model that is never
 * asked to state a position cannot fabricate one.
 */
export type ClaimCandidate = {
  claim: string;
  quote: string;
  /** Advisory only. Never gates shipping. See docs/Evidence-System.md. */
  confidence?: number;
};

/** A claim after the evidence gate has resolved it against the transcript. */
export type Evidence = ClaimCandidate & {
  segmentIds: string[];
  startMs: number;
  endMs: number;
  speaker: string;
};

export type NotesMetadata = {
  exitStatus: JobExitStatus;
  droppedClaims: number;
  droppedSections: string[];
  promptVersion: string;
  sttModel: string | null;
  llmModel: string;
  tokensUsed: number;
  durationMs: number;
  generatedAt: string;
};

/**
 * Output with no citation attached.
 *
 * **Uncited, not unverified.** The distinction matters: PyAI Recap's action items are derived from
 * this call and are generally accurate — what they lack is a quote, so there is no moment to jump
 * to and our gate has nothing to resolve. Calling them "unverified" implied they might be false,
 * which misrepresents them and undersells a real vendor feature.
 *
 * They are kept separate because ADR-002 allows inferential output only when it is separately
 * labelled, and because a claim the reader cannot check must never sit beside one they can. Never
 * counted among the evidenced claims.
 */
export type UncitedNotes = {
  /** Where it came from, e.g. `pyai-recap`. Shown to the reader, not just logged. */
  source: string;
  actionItems: Array<{ task: string; owner?: string; due?: string }>;
  /** Free prose. Recap writes one paragraph; it has no per-item positions either. */
  nextSteps?: string;
  /**
   * What the call settled, e.g. "Six-month term instead of annual".
   *
   * Recap returns these and we used to read them off the wire and throw them away, which is the
   * worst of the three options: the unit was paid for, the content is what a reader opens the notes
   * for, and dropping it silently made the page look like the vendor had produced less than it had.
   * Quoteless like the action items, so it lives here rather than among the claims.
   */
  keyDecisions?: string[];
};

export type CallNotes = {
  callId: string;
  exitStatus: JobExitStatus;
  /** Derived section — synthesized from surviving claims only (ADR-013). */
  summary: string;
  /**
   * `null` when no intent claim survived the gate.
   *
   * It used to be a non-null `Evidence` filled with empty strings and an empty `segmentIds`, which
   * was a sentinel that lied about its own type: every field `Evidence` guarantees was violated, and
   * `CallNotesSchema` rejected the result — so a call with no surviving intent could not be served at
   * all. Every consumer already tested `intent.claim` for truthiness before using it, so absence was
   * the model the code believed in; only the type insisted otherwise.
   */
  intent: Evidence | null;
  objections: Evidence[];
  nextSteps: Evidence[];
  /** Derived section — synthesized from surviving claims only (ADR-013). */
  followUpEmail: string;
  /** Present only when a source produced useful output with no quote to cite. */
  uncited?: UncitedNotes;
  metadata: NotesMetadata;
};

/** Result of resolving a quote against the transcript. */
export type EvidenceMatch = {
  segmentIds: string[];
  startMs: number;
  endMs: number;
  speaker: string;
  /** 1 for an exact normalized match, otherwise the windowed similarity score. */
  score: number;
};
