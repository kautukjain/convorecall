import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { TranscriptSegment } from "@opengong/types";
import {
  buildTranscriptIndex,
  normalizeForMatch,
  resolveQuoteInSegments,
  tokenize,
} from "./index.js";

const ROOT = resolve(import.meta.dirname, "../../..");

type GoldenCase = {
  id: string;
  claim: string;
  quote?: string;
  segmentId?: string;
  speaker?: string;
  required?: boolean;
};

const transcript = JSON.parse(
  readFileSync(
    resolve(ROOT, "sample-data/transcripts/objection-call.json"),
    "utf8",
  ),
) as { segments: TranscriptSegment[] };

const golden = JSON.parse(
  readFileSync(
    resolve(ROOT, "evals/objections/objection-call.golden.json"),
    "utf8",
  ),
) as { positive: GoldenCase[]; negative: GoldenCase[] };

const segments = transcript.segments;

describe("normalizeForMatch", () => {
  it("collapses whitespace and case", () => {
    expect(normalizeForMatch("  Hello   THERE  ")).toBe("hello there");
  });

  it("folds curly quotes so model output matches transcript text", () => {
    expect(normalizeForMatch("we’re")).toBe("we are");
  });

  it("canonicalizes contractions on both sides", () => {
    expect(normalizeForMatch("we'd need")).toBe("we would need");
    expect(normalizeForMatch("didn't trust")).toBe("did not trust");
    expect(normalizeForMatch("won't ignore")).toBe("will not ignore");
  });

  it("leaves possessive 's alone", () => {
    expect(normalizeForMatch("Dave's team")).toBe("dave's team");
  });
});

describe("tokenize", () => {
  it("strips punctuation at boundaries but keeps it inside a token", () => {
    expect(tokenize("(the price, $40k) and 12.5% growth.")).toEqual([
      "the",
      "price",
      "$40k",
      "and",
      "12.5%",
      "growth",
    ]);
  });

  // Spike 2a: STT writes "buy in", a model quoting it writes "buy-in". Splitting
  // intra-word hyphens on both sides is what stops that claim being dropped.
  it("splits compound words on hyphens so both renderings agree", () => {
    expect(tokenize("buy-in from finance")).toEqual([
      "buy",
      "in",
      "from",
      "finance",
    ]);
    expect(tokenize("buy in from finance")).toEqual([
      "buy",
      "in",
      "from",
      "finance",
    ]);
    expect(normalizeForMatch("re-onboard")).toBe("re onboard");
  });
});

describe("resolveQuote", () => {
  it("resolves an exact quote to its segment", () => {
    const match = resolveQuoteInSegments(
      segments,
      "We're not sure we can justify that pricing",
    );
    expect(match?.segmentIds).toEqual(["seg-14"]);
    expect(match?.speaker).toBe("Prospect");
    expect(match?.score).toBe(1);
    expect(match?.startMs).toBe(61200);
  });

  it("resolves a contraction-expanded quote as an exact match", () => {
    const match = resolveQuoteInSegments(
      segments,
      "we are not sure we can justify that pricing",
    );
    expect(match?.segmentIds).toEqual(["seg-14"]);
    expect(match?.score).toBe(1);
  });

  it("resolves a light paraphrase above threshold via stage 2", () => {
    const match = resolveQuoteInSegments(
      segments,
      "we're not sure we can justify the pricing right now",
    );
    expect(match?.segmentIds).toEqual(["seg-14"]);
    expect(match?.score).toBeLessThan(1);
    expect(match?.score).toBeGreaterThanOrEqual(0.85);
  });

  it("resolves a quote spanning two segments and attributes the majority speaker", () => {
    const match = resolveQuoteInSegments(
      segments,
      "for it to make sense? Honestly? Honestly we'd need buy-in from finance",
    );
    expect(match?.segmentIds).toEqual(["seg-15", "seg-16"]);
    expect(match?.speaker).toBe("Prospect");
  });

  it("returns null for a fabricated quote", () => {
    expect(
      resolveQuoteInSegments(segments, "The customer said the price was too high"),
    ).toBeNull();
  });

  it("returns null for a plausible statement that was never made", () => {
    expect(
      resolveQuoteInSegments(segments, "We need approval from procurement"),
    ).toBeNull();
  });

  it("returns null for an empty quote", () => {
    expect(resolveQuoteInSegments(segments, "   ")).toBeNull();
  });
});

// The point of the golden file (ADR-015): ground truth the matcher is graded against.
describe("golden file: objection-call", () => {
  it.each(golden.positive.map((c) => [c.id, c] as const))(
    "positive case %s resolves to its recorded segment",
    (_id, testCase) => {
      expect(testCase.quote).toBeDefined();
      const match = resolveQuoteInSegments(segments, testCase.quote as string);
      expect(match).not.toBeNull();
      expect(match?.segmentIds).toContain(testCase.segmentId);
      expect(match?.speaker).toBe(testCase.speaker);
    },
  );

  it.each(golden.negative.map((c) => [c.id, c] as const))(
    "negative case %s does not resolve",
    (_id, testCase) => {
      // A hallucinating extractor would offer its own claim text as the supporting
      // quote. Nothing in this set was said, so nothing may resolve.
      expect(resolveQuoteInSegments(segments, testCase.claim)).toBeNull();
    },
  );
});

describe("buildTranscriptIndex", () => {
  it("links every token back to a segment", () => {
    const index = buildTranscriptIndex(segments);
    expect(index.tokens.length).toBeGreaterThan(300);
    for (const token of index.tokens) {
      expect(segments[token.segmentIndex]).toBeDefined();
    }
  });
});
