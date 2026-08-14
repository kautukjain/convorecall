import { describe, expect, it } from "vitest";
import { PyAiSttProvider } from "./pyai-stt.provider.js";

const provider = new PyAiSttProvider({ get: () => undefined } as never);

/**
 * Fixtures are the real shape returned by `GET /v1/transcription/jobs/{id}`, captured
 * during spike 2a against a two-speaker recording.
 */
describe("PyAiSttProvider.normalize", () => {
  const spikeResult = {
    text: "[speaker_1] thanks for making time today\n[speaker_2] we are not sure",
    speakers: 2,
    audio_seconds: 9.582,
    segments: [
      {
        id: 0,
        start: 0,
        end: 4.32,
        text: "thanks for making time today i know you have a hard stop at half past",
        speaker: "speaker_1",
      },
      {
        id: 1,
        start: 4.32,
        end: 9.36,
        text: "we are not sure we can justify that pricing right now",
        speaker: "speaker_2",
      },
    ],
  };

  it("converts seconds to milliseconds", () => {
    const result = provider.normalize(spikeResult, "pyai-hear");
    expect(result.segments[0]).toMatchObject({ startMs: 0, endMs: 4_320 });
    expect(result.segments[1]).toMatchObject({ startMs: 4_320, endMs: 9_360 });
    expect(result.durationMs).toBe(9_582);
    expect(result.model).toBe("pyai-hear");
  });

  it("maps provider speaker ids to positional labels in order of appearance", () => {
    const result = provider.normalize(spikeResult, "pyai-hear");
    expect(result.segments.map((s) => s.speaker)).toEqual([
      "Speaker 1",
      "Speaker 2",
    ]);
  });

  it("keeps the same label for a speaker who returns later", () => {
    const result = provider.normalize(
      {
        segments: [
          { start: 0, end: 1, text: "one", speaker: "speaker_2" },
          { start: 1, end: 2, text: "two", speaker: "speaker_1" },
          { start: 2, end: 3, text: "three", speaker: "speaker_2" },
        ],
      },
      "pyai-hear",
    );
    expect(result.segments.map((s) => s.speaker)).toEqual([
      "Speaker 1",
      "Speaker 2",
      "Speaker 1",
    ]);
  });

  it("degrades to one speaker when diarization is missing", () => {
    const result = provider.normalize(
      { segments: [{ start: 0, end: 1, text: "hello" }] },
      "pyai-hear",
    );
    expect(result.segments[0]?.speaker).toBe("Speaker 1");
  });

  it("derives duration from segments when audio_seconds is absent", () => {
    const result = provider.normalize(
      { segments: [{ start: 0, end: 7.5, text: "hello" }] },
      "pyai-hear",
    );
    expect(result.durationMs).toBe(7_500);
  });

  it("drops blank segments rather than persisting empty lines", () => {
    const result = provider.normalize(
      {
        segments: [
          { start: 0, end: 1, text: "  ", speaker: "speaker_1" },
          { start: 1, end: 2, text: "real", speaker: "speaker_1" },
        ],
      },
      "pyai-hear",
    );
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.text).toBe("real");
  });

  it("fails loudly on an empty transcript instead of returning nothing", () => {
    expect(() => provider.normalize({ segments: [] }, "pyai-hear")).toThrow();
    expect(() =>
      provider.normalize({ segments: [{ start: 0, end: 1, text: "" }] }, "pyai-hear"),
    ).toThrow();
  });
});
