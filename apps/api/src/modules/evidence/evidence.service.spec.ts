import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { TranscriptSegment } from "@opengong/types";
import { EvidenceService } from "./evidence.service.js";

const ROOT = resolve(import.meta.dirname, "../../../../..");

const transcript = JSON.parse(
  readFileSync(resolve(ROOT, "sample-data/transcripts/objection-call.json"), "utf8"),
) as { segments: TranscriptSegment[] };

const golden = JSON.parse(
  readFileSync(resolve(ROOT, "evals/objections/objection-call.golden.json"), "utf8"),
) as {
  positive: Array<{ id: string; claim: string; quote: string; segmentId: string }>;
  negative: Array<{ id: string; claim: string }>;
};

const service = new EvidenceService({ get: () => undefined } as never);
const segments = transcript.segments;

describe("EvidenceService.gate", () => {
  it("keeps a claim whose quote resolves, deriving position and speaker", () => {
    const { kept, dropped } = service.gate(
      [
        {
          claim: "Prospect cannot justify the pricing.",
          quote: "We're not sure we can justify that pricing right now.",
        },
      ],
      segments,
    );

    expect(dropped).toBe(0);
    expect(kept).toHaveLength(1);
    // The model supplied none of these — they are computed (ADR-009).
    expect(kept[0]?.segmentIds).toEqual(["seg-14"]);
    expect(kept[0]?.speaker).toBe("Prospect");
    expect(kept[0]?.startMs).toBe(61_200);
  });

  it("discards any position the model tries to assert", () => {
    const { kept } = service.gate(
      [
        {
          claim: "Prospect cannot justify the pricing.",
          quote: "We're not sure we can justify that pricing right now.",
          // A model may emit these; the schema strips them and the gate recomputes.
          segmentIds: ["seg-99"],
          startMs: 999_999,
          speaker: "Rep",
        } as never,
      ],
      segments,
    );
    expect(kept[0]?.segmentIds).toEqual(["seg-14"]);
    expect(kept[0]?.speaker).toBe("Prospect");
    expect(kept[0]?.startMs).toBe(61_200);
  });

  it("keeps a low-confidence claim that resolved, marked rather than dropped", () => {
    const { kept, dropped } = service.gate(
      [
        {
          claim: "Budget sits with finance.",
          quote: "we'd need buy-in from finance, and Dave owns that",
          confidence: 0.42,
        },
      ],
      segments,
    );
    expect(dropped).toBe(0);
    expect(kept[0]?.confidence).toBe(0.42);
  });

  it("drops an unevidenced claim and counts it", () => {
    const { kept, dropped } = service.gate(
      [
        { claim: "Real", quote: "We're not sure we can justify that pricing" },
        { claim: "Invented", quote: "The customer demanded a refund immediately" },
      ],
      segments,
    );
    expect(kept).toHaveLength(1);
    expect(dropped).toBe(1);
  });

  // The golden file is the point (ADR-015): ground truth the gate is graded against.
  it("keeps every positive golden case, on its recorded segment", () => {
    const { kept, dropped } = service.gate(
      golden.positive.map((c) => ({ claim: c.claim, quote: c.quote })),
      segments,
    );
    expect(dropped).toBe(0);
    expect(kept).toHaveLength(golden.positive.length);
    kept.forEach((evidence, i) => {
      expect(evidence.segmentIds).toContain(golden.positive[i]?.segmentId);
    });
  });

  it("drops every negative golden case — hallucination rate must be zero", () => {
    const { kept, dropped } = service.gate(
      golden.negative.map((c) => ({ claim: c.claim, quote: c.claim })),
      segments,
    );
    expect(kept).toHaveLength(0);
    expect(dropped).toBe(golden.negative.length);
  });
});
