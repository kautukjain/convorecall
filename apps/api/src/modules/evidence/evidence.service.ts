import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  HARNESS_DEFAULTS,
  buildTranscriptIndex,
  resolveQuote,
} from "@opengong/shared";
import type {
  ClaimCandidate,
  Evidence,
  TranscriptSegment,
} from "@opengong/types";

export type GateResult = {
  kept: Evidence[];
  dropped: number;
};

/**
 * The evidence gate (ADR-002, ADR-009).
 *
 * A claim ships only if its quote resolves to a real span of the transcript. Position and
 * speaker are derived here from the match — anything the model asserted about them was
 * already discarded by the schema.
 */
@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);

  constructor(private readonly config: ConfigService) {}

  gate(candidates: ClaimCandidate[], segments: TranscriptSegment[]): GateResult {
    if (candidates.length === 0) return { kept: [], dropped: 0 };

    const threshold =
      this.config.get<number>("EVIDENCE_MATCH_THRESHOLD") ??
      HARNESS_DEFAULTS.EVIDENCE_MATCH_THRESHOLD;
    const index = buildTranscriptIndex(segments);

    const kept: Evidence[] = [];
    let dropped = 0;

    for (const candidate of candidates) {
      const match = resolveQuote(index, candidate.quote, threshold);
      if (!match) {
        dropped += 1;
        this.logger.warn(
          `Dropped unevidenced claim: ${candidate.claim.slice(0, 80)}`,
        );
        continue;
      }

      kept.push({
        claim: candidate.claim,
        quote: candidate.quote,
        confidence: candidate.confidence,
        segmentIds: match.segmentIds,
        startMs: match.startMs,
        endMs: match.endMs,
        speaker: match.speaker,
      });
    }

    return { kept, dropped };
  }
}
