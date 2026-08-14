import { Injectable, Logger } from "@nestjs/common";
import { normalizeForMatch, resolveQuoteInSegments } from "@opengong/shared";

/** Structural minimum the matcher needs; both Prisma rows and shared types satisfy it. */
type Segment = {
  id: string;
  index: number;
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
};

export type SpeakerNameCandidate = {
  label: string;
  name: string;
  quote: string;
};

/**
 * Turns "Speaker 1" into "Marcus" — but only on evidence.
 *
 * Diarization separates voices; it cannot name them. The names are usually present in
 * the words ("thanks Marcus", "it's Nadia here"), so a model can infer the mapping. That
 * inference gets the same treatment as every other claim: a name is applied only if its
 * quote resolves to the transcript **and** the name actually appears inside that quote.
 *
 * The limit worth being honest about: the quote proves the name was said at that moment.
 * Which speaker it belongs to is the model's inference, bounded but not proven — a
 * self-introduction is direct evidence, a direct address is one step of reasoning. When
 * nothing resolves, the positional label stays, because "Speaker 2" is honest and
 * "Marcus" would not be.
 */
@Injectable()
export class SpeakerNamingService {
  private readonly logger = new Logger(SpeakerNamingService.name);

  /** Labels that came from diarization rather than an authored fixture. */
  static needsNaming(segments: Segment[]): boolean {
    const speakers = new Set(segments.map((s) => s.speaker));
    return [...speakers].every((s) => /^Speaker \d+$/.test(s));
  }

  /**
   * Returns the label→name mapping that survived verification. Unnamed labels are
   * simply absent.
   */
  gate(
    candidates: SpeakerNameCandidate[],
    segments: Segment[],
  ): Map<string, string> {
    const labels = new Set(segments.map((s) => s.speaker));
    const accepted = new Map<string, string>();
    const claimedNames = new Set<string>();

    for (const candidate of candidates) {
      if (!labels.has(candidate.label)) {
        this.logger.warn(`Dropped name for unknown label "${candidate.label}"`);
        continue;
      }
      if (accepted.has(candidate.label)) continue;

      const match = resolveQuoteInSegments(segments, candidate.quote);
      if (!match) {
        this.logger.warn(
          `Dropped name "${candidate.name}" — quote does not resolve`,
        );
        continue;
      }

      // The quote must actually contain the name. Without this a model could attach any
      // name to any real sentence and the match alone would wave it through.
      if (!normalizeForMatch(candidate.quote).includes(normalizeForMatch(candidate.name))) {
        this.logger.warn(
          `Dropped name "${candidate.name}" — not present in its own quote`,
        );
        continue;
      }

      // Two speakers with one name means the mapping is wrong somewhere; keep neither.
      if (claimedNames.has(normalizeForMatch(candidate.name))) {
        this.logger.warn(`Dropped duplicate name "${candidate.name}"`);
        continue;
      }

      claimedNames.add(normalizeForMatch(candidate.name));
      accepted.set(candidate.label, candidate.name.trim());
    }

    return accepted;
  }

  /** Applies accepted names, leaving unnamed speakers on their positional label. */
  apply<T extends { speaker: string }>(
    segments: T[],
    names: Map<string, string>,
  ): T[] {
    if (names.size === 0) return segments;
    return segments.map((segment) => ({
      ...segment,
      speaker: names.get(segment.speaker) ?? segment.speaker,
    }));
  }
}
