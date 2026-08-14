import type { DerivedSection, EvidencedSection } from "@opengong/prompts";
import type { ClaimCandidate, UncitedNotes } from "@opengong/types";
import type { SectionOutcome } from "./ai-orchestrator.service.js";

/**
 * Where a section's raw, ungated output comes from.
 *
 * `AiOrchestratorService` is the live implementation and satisfies this structurally. The
 * point of naming the shape is that the harness in `NotesService` never learns which one it
 * is holding: a replayed claim goes through the same evidence gate, the same section-drop
 * accounting, and the same exit-status resolution as one a model produced a second ago.
 *
 * That is the whole reason replay is safe to demo. If the offline path skipped the gate it
 * would be a slideshow, and the gate is the thing worth showing.
 */
export interface ExtractionSource {
  /**
   * Useful output this source produced without a quote to cite.
   *
   * Optional because most sources have none: a model is asked for a quote, and its claims either
   * resolve or are dropped. PyAI Recap is the case that needs it — action items with an owner and a
   * due date, and a next-steps paragraph, none carrying a position. Uncited is not the same as
   * untrue; ADR-002 simply requires it be labelled separately rather than mixed into claims.
   */
  uncited?(): UncitedNotes | null;

  extractClaims(
    section: EvidencedSection,
    segments: Array<{ speaker: string; text: string }>,
  ): Promise<SectionOutcome<ClaimCandidate[]>>;

  synthesize(
    section: DerivedSection,
    claims: Array<{ section: string; claim: string; quote: string }>,
  ): Promise<SectionOutcome<string>>;
}
