import { describe, expect, it } from "vitest";
import type { CallNotes, Evidence } from "@convorecall/types";
import { renderNotesMarkdown, safeFilename } from "./markdown.js";

const evidence = (over: Partial<Evidence> = {}): Evidence => ({
  claim: "Prospect cannot justify the pricing.",
  quote: "We're not sure we can justify that pricing right now.",
  segmentIds: ["seg-8"],
  startMs: 76_500,
  endMs: 83_000,
  speaker: "Prospect",
  ...over,
});

const notes = (over: Partial<CallNotes> = {}): CallNotes => ({
  callId: "abc-123",
  exitStatus: "partial",
  summary: "A short factual summary.",
  intent: evidence({ claim: "Prospect is interested but blocked on budget." }),
  objections: [evidence()],
  nextSteps: [evidence({ claim: "Rep will send a one-pager by Tuesday." })],
  followUpEmail: "Hi Marcus,\n\nThanks for the time today.",
  metadata: {
    exitStatus: "partial",
    droppedClaims: 3,
    droppedSections: [],
    promptVersion: "v1",
    sttModel: "pyai-hear",
    llmModel: "test-model",
    tokensUsed: 4191,
    durationMs: 12_000,
    generatedAt: "2026-08-10T09:00:00.000Z",
  },
  ...over,
});

describe("renderNotesMarkdown", () => {
  /** An export without receipts is just another AI summary. */
  it("carries the quote, speaker, and timestamp for every claim", () => {
    const md = renderNotesMarkdown(notes());
    expect(md).toContain("“We're not sure we can justify that pricing right now.”");
    expect(md).toContain("— Prospect, 1:16");
  });

  it("states how many claims were removed rather than hiding it", () => {
    expect(renderNotesMarkdown(notes())).toContain("3 claim(s) were removed");
  });

  it("omits the removal notice when nothing was dropped", () => {
    const md = renderNotesMarkdown(
      notes({
        exitStatus: "shipped",
        metadata: { ...notes().metadata, droppedClaims: 0, exitStatus: "shipped" },
      }),
    );
    expect(md).not.toContain("were removed");
    expect(md).toContain("every claim verified");
  });

  it("marks low-confidence claims", () => {
    const md = renderNotesMarkdown(
      notes({ objections: [evidence({ confidence: 0.4 })] }),
    );
    expect(md).toContain("_(low confidence)_");
  });

  it("says so explicitly when a section survived nothing", () => {
    const md = renderNotesMarkdown(notes({ objections: [] }));
    expect(md).toContain("Nothing here could be verified");
  });

  it("records provenance for reproducibility", () => {
    const md = renderNotesMarkdown(notes());
    expect(md).toContain("prompts v1");
    expect(md).toContain("stt pyai-hear");
    expect(md).toContain("model test-model");
  });
});

describe("safeFilename", () => {
  it("strips anything that is not id-safe", () => {
    expect(safeFilename("abc-123", "md")).toBe("convorecall-abc-123.md");
    expect(safeFilename('../../etc/passwd"', "json")).toBe("convorecall-etcpasswd.json");
    expect(safeFilename("", "md")).toBe("convorecall-call.md");
  });
});
