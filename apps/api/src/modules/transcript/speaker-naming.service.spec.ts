import { describe, expect, it } from "vitest";
import { SpeakerNamingService } from "./speaker-naming.service.js";

const service = new SpeakerNamingService();

const segments = [
  { id: "s1", index: 1, speaker: "Speaker 1", startMs: 0, endMs: 3000,
    text: "Hey Marcus. Can you hear me?" },
  { id: "s2", index: 2, speaker: "Speaker 2", startMs: 3200, endMs: 6000,
    text: "Yeah, I can hear you now." },
  { id: "s3", index: 3, speaker: "Speaker 1", startMs: 6200, endMs: 9000,
    text: "Dave owns the budget, so he'll need to see it." },
];

describe("needsNaming", () => {
  it("is true only when every speaker is a positional label", () => {
    expect(SpeakerNamingService.needsNaming(segments)).toBe(true);
    expect(
      SpeakerNamingService.needsNaming([
        { ...segments[0]!, speaker: "Rep" },
        segments[1]!,
      ]),
    ).toBe(false);
  });
});

describe("SpeakerNamingService.gate", () => {
  it("accepts a name whose quote resolves and contains it", () => {
    const names = service.gate(
      [{ label: "Speaker 2", name: "Marcus", quote: "Hey Marcus. Can you hear me?" }],
      segments,
    );
    expect(names.get("Speaker 2")).toBe("Marcus");
  });

  /** The load-bearing check: a real sentence must not launder an invented name. */
  it("rejects a name that is not inside its own quote", () => {
    const names = service.gate(
      [{ label: "Speaker 2", name: "Priya", quote: "Yeah, I can hear you now." }],
      segments,
    );
    expect(names.size).toBe(0);
  });

  it("rejects a name whose quote was never said", () => {
    const names = service.gate(
      [{ label: "Speaker 2", name: "Marcus", quote: "Hi Marcus, good to meet you" }],
      segments,
    );
    expect(names.size).toBe(0);
  });

  it("rejects a label that is not in the transcript", () => {
    const names = service.gate(
      [{ label: "Speaker 9", name: "Marcus", quote: "Hey Marcus. Can you hear me?" }],
      segments,
    );
    expect(names.size).toBe(0);
  });

  it("rejects the same name claimed for two speakers", () => {
    const names = service.gate(
      [
        { label: "Speaker 1", name: "Marcus", quote: "Hey Marcus. Can you hear me?" },
        { label: "Speaker 2", name: "Marcus", quote: "Hey Marcus. Can you hear me?" },
      ],
      segments,
    );
    expect(names.size).toBe(1);
  });

  // A third party discussed on the call is not a participant.
  it("does not name a speaker after someone merely mentioned", () => {
    const names = service.gate(
      [{ label: "Speaker 2", name: "Dave", quote: "Yeah, I can hear you now." }],
      segments,
    );
    expect(names.size).toBe(0);
  });
});

describe("SpeakerNamingService.apply", () => {
  it("renames only what was verified, leaving the rest positional", () => {
    const renamed = service.apply(segments, new Map([["Speaker 2", "Marcus"]]));
    expect(renamed.map((s) => s.speaker)).toEqual([
      "Speaker 1",
      "Marcus",
      "Speaker 1",
    ]);
  });

  it("is a no-op when nothing was verified", () => {
    expect(service.apply(segments, new Map())).toBe(segments);
  });
});
