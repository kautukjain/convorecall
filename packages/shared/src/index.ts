import type {
  EvidenceMatch,
  JobExitStatus,
  TranscriptSegment,
} from "@convorecall/types";

/**
 * Harness defaults. Source of truth is the config table in docs/Harness.md.
 * These are fallbacks; runtime values come from ConfigService.
 */
export const HARNESS_DEFAULTS = {
  JOB_DEADLINE_MS: 900_000,
  JOB_TOKEN_BUDGET: 120_000,
  LLM_REQUEST_TIMEOUT_MS: 30_000,
  STT_REQUEST_TIMEOUT_MS: 600_000,
  TRANSPORT_RETRY_MAX: 3,
  SCHEMA_REPAIR_MAX: 1,
  EVIDENCE_MATCH_THRESHOLD: 0.85,
} as const;

/** Worker defaults. Source of truth is the config table in docs/Jobs.md. */
export const WORKER_DEFAULTS = {
  WORKER_CONCURRENCY: 2,
  WORKER_POLL_INTERVAL_MS: 2_000,
  WORKER_HEARTBEAT_MS: 10_000,
  WORKER_STALE_AFTER_MS: 60_000,
  JOB_MAX_ATTEMPTS: 3,
} as const;

const TERMINAL_STATUSES: readonly JobExitStatus[] = [
  "shipped",
  "partial",
  "failed",
  "deadline",
];

export function isTerminalStatus(status: string): status is JobExitStatus {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

// ---------------------------------------------------------------------------
// Evidence matching (docs/Evidence-System.md)
// ---------------------------------------------------------------------------

/**
 * Normalization applied to both quote and transcript before comparison.
 * Punctuation is stripped at token boundaries only, so `$40k` and `re-onboard`
 * survive intact.
 */
/**
 * Contractions are canonicalized, not translated. Both the quote and the transcript get
 * the same treatment, so consistency matters more than linguistic correctness — `we'd`
 * always becomes `we would`, and a model writing either form still matches.
 *
 * `'s` is deliberately left alone: it is ambiguous between "is" and a possessive, and
 * expanding it would turn `Dave's team` into `dave is team`.
 */
function expandContractions(text: string): string {
  return text
    .replace(/\bwon't\b/g, "will not")
    .replace(/\bcan't\b/g, "cannot")
    .replace(/\bshan't\b/g, "shall not")
    .replace(/(\w)n't\b/g, "$1 not")
    .replace(/(\w)'re\b/g, "$1 are")
    .replace(/(\w)'ve\b/g, "$1 have")
    .replace(/(\w)'ll\b/g, "$1 will")
    .replace(/(\w)'d\b/g, "$1 would")
    .replace(/(\w)'m\b/g, "$1 am");
}

export function normalizeForMatch(text: string): string {
  return expandContractions(
    text
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[‘’‛]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[‐-―]/g, "-"),
  )
    // Compound words are rendered inconsistently: STT emits "buy in" where a model
    // quoting the same moment writes "buy-in". Splitting intra-word hyphens on both
    // sides makes them agree. Verified against real provider output in spike 2a.
    .replace(/(?<=[\p{L}\p{N}])-(?=[\p{L}\p{N}])/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const BOUNDARY_PUNCTUATION = /^[^\p{L}\p{N}$]+|[^\p{L}\p{N}%]+$/gu;

export function tokenize(text: string): string[] {
  return normalizeForMatch(text)
    .split(" ")
    .map((token) => token.replace(BOUNDARY_PUNCTUATION, ""))
    .filter((token) => token.length > 0);
}

type IndexedToken = { text: string; segmentIndex: number };

export type TranscriptIndex = {
  tokens: IndexedToken[];
  segments: TranscriptSegment[];
};

/**
 * Builds a token stream across the whole transcript, each token remembering which
 * segment it came from. Matching happens in token space so a quote spanning a segment
 * boundary resolves normally; the segment link is what maps a match back to real IDs
 * and offsets.
 */
export function buildTranscriptIndex(
  segments: TranscriptSegment[],
): TranscriptIndex {
  const tokens: IndexedToken[] = [];
  segments.forEach((segment, segmentIndex) => {
    for (const text of tokenize(segment.text)) {
      tokens.push({ text, segmentIndex });
    }
  });
  return { tokens, segments };
}

/** Levenshtein distance over token sequences. */
function tokenDistance(a: string[], b: string[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const current: number[] = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }

  return previous[b.length] ?? Math.max(a.length, b.length);
}

function similarity(a: string[], b: string[]): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  return 1 - tokenDistance(a, b) / longest;
}

function resolveSpan(
  index: TranscriptIndex,
  from: number,
  to: number,
  score: number,
): EvidenceMatch | null {
  const touched = new Map<number, number>();
  for (let i = from; i < to; i += 1) {
    const token = index.tokens[i];
    if (!token) continue;
    touched.set(token.segmentIndex, (touched.get(token.segmentIndex) ?? 0) + 1);
  }
  if (touched.size === 0) return null;

  const ordered = [...touched.keys()].sort((a, b) => a - b);
  const matched = ordered
    .map((i) => index.segments[i])
    .filter((segment): segment is TranscriptSegment => segment !== undefined);
  if (matched.length === 0) return null;

  // A quote crossing a speaker change is attributed to the segment holding the
  // majority of matched tokens, while the span still covers everything it touched.
  let majorityIndex = ordered[0] ?? 0;
  let majorityCount = -1;
  for (const [segmentIndex, count] of touched) {
    if (count > majorityCount) {
      majorityCount = count;
      majorityIndex = segmentIndex;
    }
  }
  const majority = index.segments[majorityIndex];
  if (!majority) return null;

  const first = matched[0];
  const last = matched[matched.length - 1];
  if (!first || !last) return null;

  return {
    segmentIds: matched.map((segment) => segment.id),
    startMs: first.startMs,
    endMs: last.endMs,
    speaker: majority.speaker,
    score,
  };
}

/**
 * Resolves a model-supplied quote to a transcript span.
 *
 * Stage 1 is an exact normalized token match. Stage 2 is a windowed token-similarity
 * search, which keeps honest paraphrases that exact matching would drop. Returns null
 * when nothing clears the threshold — the caller drops the claim and counts it.
 */
export function resolveQuote(
  index: TranscriptIndex,
  quote: string,
  threshold: number = HARNESS_DEFAULTS.EVIDENCE_MATCH_THRESHOLD,
): EvidenceMatch | null {
  const needle = tokenize(quote);
  if (needle.length === 0) return null;

  const haystack = index.tokens;
  if (haystack.length === 0) return null;

  // Stage 1 — exact contiguous token match.
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let hit = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset]?.text !== needle[offset]) {
        hit = false;
        break;
      }
    }
    if (hit) return resolveSpan(index, start, start + needle.length, 1);
  }

  // Stage 2 — windowed similarity, window sized to the quote ±25%.
  const sizes = new Set<number>();
  for (const factor of [0.75, 1, 1.25]) {
    const size = Math.round(needle.length * factor);
    if (size > 0 && size <= haystack.length) sizes.add(size);
  }

  let best: EvidenceMatch | null = null;
  for (const size of sizes) {
    for (let start = 0; start + size <= haystack.length; start += 1) {
      const window = haystack
        .slice(start, start + size)
        .map((token) => token.text);
      const score = similarity(needle, window);
      if (score < threshold) continue;
      if (best && score <= best.score) continue;
      const span = resolveSpan(index, start, start + size, score);
      if (span) best = span;
    }
  }

  return best;
}

/** Convenience wrapper for callers holding raw segments. */
export function resolveQuoteInSegments(
  segments: TranscriptSegment[],
  quote: string,
  threshold?: number,
): EvidenceMatch | null {
  return resolveQuote(buildTranscriptIndex(segments), quote, threshold);
}
