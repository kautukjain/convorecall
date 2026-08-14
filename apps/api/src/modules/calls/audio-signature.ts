/**
 * Content sniffing for accepted audio types.
 *
 * The client-supplied filename and Content-Type are advisory and are never trusted
 * (.cursor/rules/security.mdc, docs/API.md). This reads the actual bytes.
 */
export const ACCEPTED_MIME_TYPES = [
  "audio/mpeg",
  "audio/wav",
  "audio/mp4",
  "audio/m4a",
  "audio/webm",
] as const;

export type DetectedAudio = (typeof ACCEPTED_MIME_TYPES)[number];

function startsWith(buffer: Buffer, bytes: number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, i) => buffer[offset + i] === byte);
}

function asciiAt(buffer: Buffer, offset: number, length: number): string {
  if (buffer.length < offset + length) return "";
  return buffer.subarray(offset, offset + length).toString("ascii");
}

/**
 * Returns the detected media type, or null if the bytes are not an accepted audio
 * container. Null means reject — never fall back to the declared type.
 */
export function detectAudioType(buffer: Buffer): DetectedAudio | null {
  // WAV: "RIFF" ....  "WAVE"
  if (asciiAt(buffer, 0, 4) === "RIFF" && asciiAt(buffer, 8, 4) === "WAVE") {
    return "audio/wav";
  }

  // WebM / Matroska: EBML header
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) {
    return "audio/webm";
  }

  // ISO-BMFF (MP4/M4A): "ftyp" at offset 4, then a brand
  if (asciiAt(buffer, 4, 4) === "ftyp") {
    const brand = asciiAt(buffer, 8, 4);
    if (brand.startsWith("M4A")) return "audio/m4a";
    return "audio/mp4";
  }

  // MP3: an ID3v2 tag, or a raw MPEG audio frame sync.
  if (asciiAt(buffer, 0, 3) === "ID3") {
    return "audio/mpeg";
  }
  const first = buffer[0];
  const second = buffer[1];
  if (first === 0xff && second !== undefined && (second & 0xe0) === 0xe0) {
    return "audio/mpeg";
  }

  return null;
}

/** Bytes needed before a decision can be made. */
export const SIGNATURE_PROBE_BYTES = 16;
