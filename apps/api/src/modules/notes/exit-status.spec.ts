import { describe, expect, it } from "vitest";
import { resolveExitStatus } from "./exit-status.js";

const base = {
  droppedSections: [] as string[],
  droppedClaims: 0,
  budgetExhausted: false,
};

describe("resolveExitStatus (ADR-011)", () => {
  it("returns shipped only when nothing was lost", () => {
    expect(resolveExitStatus(base)).toBe("shipped");
  });

  it("returns partial when a single claim was dropped", () => {
    // A strict bar, deliberately: partial is the honest common case on real audio.
    expect(resolveExitStatus({ ...base, droppedClaims: 1 })).toBe("partial");
  });

  it("returns partial when a section was dropped but others survived", () => {
    expect(
      resolveExitStatus({ ...base, droppedSections: ["objections"] }),
    ).toBe("partial");
  });

  it("returns failed when every section was dropped", () => {
    expect(
      resolveExitStatus({
        ...base,
        droppedSections: [
          "summary",
          "intent",
          "objections",
          "nextSteps",
          "followUpEmail",
        ],
      }),
    ).toBe("failed");
  });

  it("returns failed on an unrecoverable error", () => {
    expect(resolveExitStatus({ ...base, unrecoverable: true })).toBe("failed");
  });

  // Precedence is the whole point of the ordering: budget beats every other outcome,
  // because "we stopped on purpose" is operationally different from "it broke".
  it("returns deadline even when content survived", () => {
    expect(resolveExitStatus({ ...base, budgetExhausted: true })).toBe("deadline");
  });

  it("returns deadline in preference to failed", () => {
    expect(
      resolveExitStatus({
        ...base,
        budgetExhausted: true,
        unrecoverable: true,
        droppedSections: ["summary", "intent", "objections", "nextSteps", "followUpEmail"],
      }),
    ).toBe("deadline");
  });

  it("returns deadline in preference to partial", () => {
    expect(
      resolveExitStatus({ ...base, budgetExhausted: true, droppedClaims: 2 }),
    ).toBe("deadline");
  });

  it("never returns shipped when anything was dropped", () => {
    const combos = [
      { droppedClaims: 1 },
      { droppedSections: ["summary"] },
      { droppedClaims: 5, droppedSections: ["intent"] },
    ];
    for (const combo of combos) {
      expect(resolveExitStatus({ ...base, ...combo })).not.toBe("shipped");
    }
  });
});
