import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Regenerates the sample recordings so their timing matches the authored transcript exactly.
 *
 * The shipped audio was a voice rendering whose clips were concatenated back to back, so it ran
 * 13–32 seconds shorter than the transcript it was rendering. Clicking a claim at 2:41 therefore
 * seeked past the end of a 2:23 file. For a product whose whole claim is "the receipt is exact",
 * audio that lands near the moment is worse than no audio at all.
 *
 * The fix is alignment by construction rather than by inference. Each segment is synthesized on
 * its own and placed at its authored `startMs` with `adelay`; `amix` lays them onto one timeline.
 * Nothing is stretched and no boundary is guessed, so segment N starts at exactly `startMs[N]`.
 * Silence detection was tried first and rejected: it found 62–73 candidate boundaries for 33 real
 * ones, and a single misread boundary shifts every segment after it.
 *
 *   pnpm build:audio                 # all five sample calls
 *   pnpm build:audio discovery-call  # just one
 *
 * Needs PYAI_API_KEY (scope `voice:synthesize`, present on the free sandbox key) and ffmpeg.
 * Clips are cached under `.data/tts-cache/`, so a re-run after a transcript edit only pays for
 * the lines that changed.
 */

const ROOT = resolve(import.meta.dirname, "..");
const CACHE = resolve(ROOT, ".data/tts-cache");
const OUT = resolve(ROOT, "sample-data/audio");

const SAMPLE_CALLS = [
  "discovery-call",
  "demo-call",
  "objection-call",
  "support-call",
  "enterprise-call",
] as const;

type Segment = { id: string; speaker: string; startMs: number; endMs: number; text: string };
type Fixture = {
  segments: Segment[];
  voices?: Record<string, string>;
};

const DEFAULT_VOICE = "stock_joy_en_us";

function env(key: string): string | undefined {
  if (!process.env[key] && existsSync(resolve(ROOT, ".env"))) {
    process.loadEnvFile(resolve(ROOT, ".env"));
  }
  return process.env[key];
}

/** One line of speech. Cached by call, index, voice and text, so edits invalidate precisely. */
async function synthesize(
  call: string,
  index: number,
  text: string,
  voice: string,
): Promise<string | null> {
  const key = `${call}-${String(index).padStart(3, "0")}-${voice}-${hash(text)}.mp3`;
  const path = resolve(CACHE, key);
  if (existsSync(path)) return path;

  const baseUrl = (env("PYAI_BASE_URL") ?? "https://api.pyai.com/v1").replace(/\/+$/, "");
  const attempts = Number(env("TRANSPORT_RETRY_MAX") ?? 3);
  let lastError = "";

  // Synthesis returns a transient `503 upstream_audio_empty` often enough to stall a 40-segment
  // call. Same policy as the rest of the codebase (ADR-007): retry 5xx and timeouts with
  // backoff, never a 4xx, which will fail the same way however long you wait.
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/audio/speech`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env("PYAI_API_KEY") ?? ""}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: env("PYAI_SPEAK_MODEL") ?? "pyai-speak",
          input: text,
          voice,
          response_format: "mp3",
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (response.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());
        // A 200 carrying no audio would cache an empty clip and silently shift nothing —
        // it would just go quiet at that timestamp. Treat it as a failure.
        if (bytes.length === 0) throw new Error("empty audio body");
        writeFileSync(path, bytes);
        return path;
      }

      lastError = `${response.status}: ${(await response.text()).slice(0, 160)}`;
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < attempts) {
      await new Promise((done) => setTimeout(done, 1_000 * 2 ** (attempt - 1)));
    }
  }

  // Giving up on one line is survivable; giving up on the call is not. Placement is absolute,
  // so a missing clip leaves silence at exactly that timestamp and shifts nothing after it.
  // Observed cause: `stock_cyrus_en_us` returns 503 `upstream_audio_empty` for very short
  // utterances such as "Please." — deterministically, and not fixable by padding, which the
  // engine trims. The caller reports which lines are silent rather than hiding it.
  console.warn(`\n    line ${index + 1} could not be synthesized (${lastError})`);
  return null;
}

/** Short, stable, filename-safe. Only needs to change when the line changes. */
function hash(text: string): string {
  let h = 0;
  for (const char of text) h = (Math.imul(31, h) + char.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

function durationOf(path: string): number {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
    { encoding: "utf8" },
  );
  return Number.parseFloat(out.trim());
}

async function build(call: string): Promise<void> {
  const fixturePath = resolve(ROOT, "sample-data/transcripts", `${call}.json`);
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
  const voices = fixture.voices ?? {};

  const placed: Array<{ clip: string; startMs: number }> = [];
  const silent: number[] = [];
  for (const [index, segment] of fixture.segments.entries()) {
    const voice = voices[segment.speaker] ?? DEFAULT_VOICE;
    const clip = await synthesize(call, index, segment.text, voice);
    if (clip) placed.push({ clip, startMs: segment.startMs });
    else silent.push(index + 1);
    process.stdout.write(`\r  ${call}: synthesized ${index + 1}/${fixture.segments.length}`);
  }
  process.stdout.write("\n");

  if (placed.length === 0) throw new Error("no lines could be synthesized");

  // Each clip is delayed to its authored start, then all of them are mixed onto one timeline.
  // Absolute placement is what makes this exact: no clip's length can shift another's position.
  const inputs = placed.flatMap(({ clip }) => ["-i", clip]);
  const delays = placed
    .map(({ startMs }, i) => `[${i}]adelay=${startMs}|${startMs}[a${i}]`)
    .join(";");
  const mix = `${placed.map((_, i) => `[a${i}]`).join("")}amix=inputs=${placed.length}:normalize=0:duration=longest[out]`;

  const output = resolve(OUT, `${call}.mp3`);
  mkdirSync(OUT, { recursive: true });
  execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      ...inputs,
      "-filter_complex",
      `${delays};${mix}`,
      "-map",
      "[out]",
      "-c:a",
      "libmp3lame",
      "-q:a",
      "4",
      output,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );

  // The check that matters: does a claim's timestamp still exist in the file?
  const transcriptEnd = Math.max(...fixture.segments.map((s) => s.endMs)) / 1000;
  const audioEnd = durationOf(output);
  const overrun = transcriptEnd - audioEnd;
  const verdict =
    Math.abs(overrun) <= 2 ? "aligned" : `STILL OFF by ${overrun.toFixed(1)}s`;
  const missing = silent.length > 0 ? ` (${silent.length} line(s) silent: ${silent.join(", ")})` : "";
  console.log(
    `  ${call}: transcript ends ${transcriptEnd.toFixed(1)}s, audio ${audioEnd.toFixed(1)}s — ${verdict}${missing}`,
  );
}

async function main(): Promise<void> {
  if (!env("PYAI_API_KEY")) {
    console.error("PYAI_API_KEY is unset. `pnpm setup` mints a free sandbox key.");
    process.exit(1);
  }
  mkdirSync(CACHE, { recursive: true });

  const requested = process.argv.slice(2);
  const calls = requested.length > 0 ? requested : [...SAMPLE_CALLS];

  let failures = 0;
  for (const call of calls) {
    try {
      await build(call);
    } catch (error) {
      failures += 1;
      console.error(
        `  ${call}: FAILED — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

void main();
