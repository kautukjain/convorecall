/**
 * Speech-to-text capability contract (ADR-003).
 *
 * Providers are configuration, not code paths. Anything provider-specific — response
 * shape, timestamp units, how diarization is expressed — is normalized here so nothing
 * downstream learns which vendor produced a transcript.
 */

export type SttSegment = {
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
};

/**
 * A proposed speaker identity, from whatever source produced the transcript. Structurally
 * identical to what the naming extractor returns, because both are unverified proposals
 * and both go through the same gate.
 */
export type SttSpeakerName = {
  label: string;
  name: string;
  quote: string;
};

export type SttResult = {
  segments: SttSegment[];
  durationMs: number;
  /** Recorded on the notes payload for reproducibility. Null in fixture mode. */
  model: string | null;
  /**
   * Names the transcript source is willing to propose. A diarizing provider has none —
   * it separates voices without learning who they are — so in practice this is how an
   * authored fixture states an identity the call itself evidences.
   */
  speakerNames?: SttSpeakerName[];
};

export type SttRequest = {
  /** Absolute path to the stored audio. */
  path: string;
  mimeType: string;
};

export interface SttProvider {
  readonly id: string;
  transcribe(request: SttRequest): Promise<SttResult>;
}

/** Speaker label used when a provider returns no diarization (risk 6). */
export const UNKNOWN_SPEAKER_PREFIX = "Speaker";
