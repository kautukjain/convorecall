import { describe, expect, it } from "vitest";
import type { Evidence } from "@convorecall/types";
import { composeEmail, deriveRecipient, isPersonName } from "./recipient.js";

function evidence(speaker: string, claim = "a claim"): Evidence {
  return {
    claim,
    quote: "a quote",
    segmentIds: ["seg-1"],
    startMs: 0,
    endMs: 1000,
    speaker,
  };
}

const NONE = evidence("", "");

describe("isPersonName", () => {
  it("accepts a name", () => {
    expect(isPersonName("Priya")).toBe(true);
    expect(isPersonName("Marcus")).toBe(true);
  });

  it("rejects a positional label from diarization", () => {
    expect(isPersonName("Speaker 1")).toBe(false);
    expect(isPersonName("speaker 12")).toBe(false);
  });

  it("rejects a role, whatever its casing", () => {
    for (const role of ["Rep", "Prospect", "customer", "VP Sales", "Account Manager"]) {
      expect(isPersonName(role)).toBe(false);
    }
  });
});

describe("deriveRecipient", () => {
  it("uses the single counterparty behind the intent and objections", () => {
    expect(deriveRecipient(evidence("Priya"), [evidence("Priya")])).toBe("Priya");
  });

  it("returns null on a multi-stakeholder call rather than picking one", () => {
    // Addressing one of three named people would be a guess dressed as a fact.
    expect(
      deriveRecipient(evidence("Sarah"), [evidence("Security"), evidence("Procurement")]),
    ).toBeNull();
  });

  it("returns null when the only speaker is a role", () => {
    expect(deriveRecipient(evidence("Prospect"), [evidence("Prospect")])).toBeNull();
  });

  it("ignores an absent intent", () => {
    expect(deriveRecipient(NONE, [evidence("Marcus")])).toBe("Marcus");
  });

  it("returns null when nothing survived", () => {
    expect(deriveRecipient(NONE, [])).toBeNull();
  });
});

describe("composeEmail", () => {
  it("greets a provable recipient and leaves the body untouched", () => {
    const body = "Thank you for the conversation today.\n\n- Send pricing";
    expect(composeEmail(body, evidence("Priya"), [evidence("Priya")])).toBe(
      `Dear Priya,\n\n${body}`,
    );
  });

  it("omits the greeting rather than inventing a placeholder", () => {
    const body = "Thank you for the conversation today.";
    const composed = composeEmail(body, evidence("Rep"), [evidence("Prospect")]);
    expect(composed).toBe(body);
    expect(composed).not.toMatch(/\[|Dear/);
  });

  it("never signs the draft — the sender is not in the data", () => {
    const composed = composeEmail("Body text.", evidence("Priya"), [evidence("Priya")]);
    expect(composed).not.toMatch(/best regards|kind regards|sincerely/i);
  });

  it("stays empty when no email was produced", () => {
    expect(composeEmail("", evidence("Priya"), [])).toBe("");
    expect(composeEmail("   ", evidence("Priya"), [])).toBe("");
  });
});
