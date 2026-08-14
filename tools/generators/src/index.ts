import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Renders a hand-authored transcript fixture into real audio.
 *
 * Uses PyAI's neural text-to-speech. The first version of this used macOS `say`, which is
 * a formant synthesizer: it reads text at a flat pitch with no turn-taking prosody, so
 * every call sounded like one person reading a script aloud — no amount of rewriting the
 * dialogue fixed that, because the problem was the synthesizer, not the words.
 *
 * Synthetic speech is still the right source for an MIT demo kit: no consent, no PII, no
 * redistribution question, and the audio describes the same conversation as the golden
 * transcript so STT output can be compared against known ground truth.
 *
 * Voices are declared per speaker in the fixture. Positional assignment cannot know that
 * a speaker addressed as "Priya" needs a female voice — that mismatch shipped once.
 *
 *   pnpm --filter @opengong/generators start -- objection-call
 */

const ROOT = resolve(import.meta.dirname, "../../..");
const SPEECH_MODEL = "pyai-voice";

type Segment = { speaker: string; text: string; startMs: number; endMs: number };

function need(command: string): void {
  try {
    execFileSync("which", [command], { stdio: "ignore" });
  } catch {
    throw new Error(`Missing required tool: ${command}`);
  }
}

async function synthesize(
  text: string,
  voice: string,
  baseUrl: string,
  apiKey: string,
): Promise<Buffer> {
  const response = await fetch(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: SPEECH_MODEL,
      input: text,
      voice,
      response_format: "mp3",
      // Telephony sample rate: this is meant to sound like a recorded call, and it is
      // what the transcription side will receive anyway.
      sample_rate: 16000,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    if (/daily_cap_exceeded/.test(body)) {
      throw new Error(
        "PyAI daily usage cap reached — speech synthesis resets at 00:00 UTC.\n" +
          "  Existing audio in sample-data/audio/ is left untouched; re-run this after the reset.",
      );
    }
    throw new Error(
      `speech failed for voice "${voice}": ${response.status} ${body}`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

async function render(callName: string): Promise<void> {
  const transcriptPath = resolve(ROOT, "sample-data/transcripts", `${callName}.json`);
  if (!existsSync(transcriptPath)) {
    throw new Error(`No transcript at sample-data/transcripts/${callName}.json`);
  }

  const transcript = JSON.parse(readFileSync(transcriptPath, "utf8")) as {
    segments: Segment[];
    voices?: Record<string, string>;
  };
  const segments = transcript.segments;
  if (segments.length === 0) throw new Error("Transcript has no segments");

  const voices = transcript.voices ?? {};
  const speakers = [...new Set(segments.map((s) => s.speaker))];
  const undeclared = speakers.filter((s) => !voices[s]);
  if (undeclared.length > 0) {
    throw new Error(
      `No voice declared for: ${undeclared.join(", ")}. Add a "voices" map to the fixture.`,
    );
  }

  const baseUrl = (process.env.PYAI_BASE_URL ?? "").replace(/\/+$/, "");
  const apiKey = process.env.PYAI_API_KEY ?? "";
  if (!baseUrl || !apiKey) {
    throw new Error("PYAI_BASE_URL and PYAI_API_KEY are required for speech synthesis");
  }

  console.log(
    `${callName}: ${speakers.map((s) => `${s}=${voices[s]}`).join(", ")}`,
  );

  const work = mkdtempSync(join(tmpdir(), "opengong-audio-"));
  try {
    const parts: string[] = [];

    for (const [i, segment] of segments.entries()) {
      const voice = voices[segment.speaker];
      if (!voice) throw new Error(`No voice for ${segment.speaker}`);

      const audio = await synthesize(segment.text, voice, baseUrl, apiKey);
      const file = join(work, `seg-${i}.mp3`);
      writeFileSync(file, audio);
      parts.push(file);
      process.stdout.write(`\r  ${i + 1}/${segments.length} segments`);

      // Keep the authored pause before the next turn so diarization has real boundaries
      // rather than a continuous wall of speech.
      const next = segments[i + 1];
      if (!next) continue;
      const gapMs = Math.max(120, Math.min(next.startMs - segment.endMs, 1_200));
      const silence = join(work, `gap-${i}.mp3`);
      execFileSync(
        "ffmpeg",
        [
          "-y", "-f", "lavfi",
          "-i", `anullsrc=r=16000:cl=mono:d=${(gapMs / 1000).toFixed(3)}`,
          "-codec:a", "libmp3lame", "-q:a", "4", silence,
        ],
        { stdio: "ignore" },
      );
      parts.push(silence);
    }
    process.stdout.write("\r");

    const listFile = join(work, "parts.txt");
    writeFileSync(listFile, parts.map((p) => `file '${p}'`).join("\n") + "\n");

    const output = resolve(ROOT, "sample-data/audio", `${callName}.mp3`);
    execFileSync(
      "ffmpeg",
      [
        "-y", "-f", "concat", "-safe", "0", "-i", listFile,
        "-ar", "16000", "-ac", "1", "-codec:a", "libmp3lame", "-q:a", "4", output,
      ],
      { stdio: "ignore" },
    );

    const seconds = execFileSync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", output,
    ])
      .toString()
      .trim();

    console.log(
      `  wrote sample-data/audio/${callName}.mp3 — ${segments.length} segments, ${Number(seconds).toFixed(0)}s`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const names = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  if (names.length === 0) {
    console.error("Usage: start -- <call-name> [<call-name>…]");
    process.exit(1);
  }
  need("ffmpeg");
  need("ffprobe");
  for (const name of names) await render(name);
}

await main();
