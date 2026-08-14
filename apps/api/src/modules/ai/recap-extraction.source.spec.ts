import { describe, expect, it } from "vitest";
import { RecapExtractionSource } from "./recap-extraction.source.js";
import { RecapClient, type RecapRecord } from "./recap.client.js";

/**
 * These tests exist because of a claim that shipped: "Buying signal: Interest", cited to
 * "I think that's everyone" at 0:00 — the seller's opening line, before anyone had said anything.
 *
 * It cleared the evidence gate legitimately. The quote was verbatim and the position was right; the
 * gate resolves quotes, and a quote that resolves is all it is asked about. What was wrong was the
 * input: Recap had been told the buyer spoke every line, so it read the seller's greeting as buyer
 * interest. The defect is only knowable at the seam, which is what is pinned here.
 */

const segment = (speaker: string, text: string, startMs: number) => ({
  speaker,
  text,
  startMs,
  endMs: startMs + 3_000,
});

/** Verbatim from `.data/recap-cache/77e3d6bd-…` — the response that produced the bad claim. */
const OBSERVED: RecapRecord = {
  buying_signals: [
    { quote: "I think that's everyone", category: "Interest" },
    { quote: "That works and I want two references in our industry", category: "Agreement" },
  ],
  objections: [{ text: "We've bought three of these and the reps used none of them" }],
};

describe("RecapClient.rolesResolved", () => {
  it("is true when a speaker label looks like our side", () => {
    const utterances = RecapClient.toUtterances([
      segment("Rep", "Okay, I think that's everyone.", 0),
      segment("Prospect", "Let's use it well.", 6_000),
    ]);

    expect(RecapClient.rolesResolved(utterances)).toBe(true);
    expect(utterances[0]?.speaker_role).toBe("agent");
    expect(utterances[1]?.speaker_role).toBe("caller");
  });

  it("does not read a buyer job title as our side", () => {
    // This test is why the pattern is anchored. `\bsales\b` matched "VP Sales" — the buyer's own
    // decision-maker on `enterprise-call` — so Recap was told the prospect was doing the selling.
    // Buyer titles are full of seller words; only a label that *is* a seller role counts.
    const utterances = RecapClient.toUtterances([
      segment("Rep", "Okay, I think that's everyone.", 0),
      segment("VP Sales", "We've bought three of these.", 6_000),
      segment("Sales Director", "And none of them stuck.", 12_000),
    ]);

    expect(utterances.map((u) => u.speaker_role)).toEqual(["agent", "caller", "caller"]);
  });

  it("is false for diarized labels, which is the normal case for an upload", () => {
    // PyAI Hear returns `Speaker N`. Nothing here matches "rep", so the seller vanishes.
    const utterances = RecapClient.toUtterances([
      segment("Speaker 1", "Okay, I think that's everyone.", 0),
      segment("Speaker 2", "Let's use it well.", 6_000),
    ]);

    expect(RecapClient.rolesResolved(utterances)).toBe(false);
    expect(utterances.every((u) => u.speaker_role === "caller")).toBe(true);
  });

  it("is false once speaker naming has succeeded, which is the trap", () => {
    // Naming runs before the Recap payload is built, so the better the transcript reads, the more
    // likely the role heuristic is to fail. A personal name looks nothing like "rep".
    const utterances = RecapClient.toUtterances([
      segment("Marcus", "Okay, I think that's everyone.", 0),
      segment("Sarah", "Let's use it well.", 6_000),
    ]);

    expect(RecapClient.rolesResolved(utterances)).toBe(false);
  });
});

describe("RecapExtractionSource intent", () => {
  it("ships buying signals when Recap knew who was selling", async () => {
    const result = await new RecapExtractionSource(OBSERVED, true).extractClaims("intent", []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((claim) => claim.quote)).toContain(
      "That works and I want two references in our industry",
    );
  });

  it("ships none when it did not, rather than the seller's greeting", async () => {
    const result = await new RecapExtractionSource(OBSERVED, false).extractClaims("intent", []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Including the good signal: with no roles, there is no basis to tell them apart, and picking
    // the plausible-looking one is a guess dressed as a citation.
    expect(result.value).toEqual([]);
  });

  it("still ships objections without roles, because they are the buyer's own words", async () => {
    const result = await new RecapExtractionSource(OBSERVED, false).extractClaims("objections", []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
  });
});
