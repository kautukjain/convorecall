import { describe, expect, it } from "vitest";
import { detectAudioType } from "./audio-signature.js";

const pad = (head: number[], length = 32): Buffer =>
  Buffer.concat([Buffer.from(head), Buffer.alloc(Math.max(0, length - head.length))]);

const ascii = (text: string): number[] => [...Buffer.from(text, "ascii")];

describe("detectAudioType", () => {
  it("detects WAV by RIFF/WAVE", () => {
    const buffer = pad([
      ...ascii("RIFF"),
      0x24, 0x08, 0x00, 0x00,
      ...ascii("WAVE"),
    ]);
    expect(detectAudioType(buffer)).toBe("audio/wav");
  });

  it("detects WebM by the EBML header", () => {
    expect(detectAudioType(pad([0x1a, 0x45, 0xdf, 0xa3]))).toBe("audio/webm");
  });

  it("detects M4A by ftyp brand", () => {
    const buffer = pad([
      0x00, 0x00, 0x00, 0x20,
      ...ascii("ftyp"),
      ...ascii("M4A "),
    ]);
    expect(detectAudioType(buffer)).toBe("audio/m4a");
  });

  it("detects generic MP4 by ftyp with another brand", () => {
    const buffer = pad([
      0x00, 0x00, 0x00, 0x20,
      ...ascii("ftyp"),
      ...ascii("isom"),
    ]);
    expect(detectAudioType(buffer)).toBe("audio/mp4");
  });

  it("detects MP3 by an ID3 tag", () => {
    expect(detectAudioType(pad([...ascii("ID3"), 0x03, 0x00]))).toBe("audio/mpeg");
  });

  it("detects MP3 by a raw frame sync", () => {
    expect(detectAudioType(pad([0xff, 0xfb, 0x90, 0x00]))).toBe("audio/mpeg");
  });

  // The security cases: a lying filename or Content-Type must not get through.
  it("rejects a PNG regardless of what it is called", () => {
    const png = pad([0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectAudioType(png)).toBeNull();
  });

  it("rejects a shell script renamed to .mp3", () => {
    expect(detectAudioType(pad(ascii("#!/bin/sh\nrm -rf /")))).toBeNull();
  });

  it("rejects a zip / office document", () => {
    expect(detectAudioType(pad([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
  });

  it("rejects an empty or truncated file", () => {
    expect(detectAudioType(Buffer.alloc(0))).toBeNull();
    expect(detectAudioType(Buffer.from([0xff]))).toBeNull();
  });
});
