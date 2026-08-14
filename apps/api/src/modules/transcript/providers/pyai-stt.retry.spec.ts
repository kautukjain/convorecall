import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PyAiSttProvider } from "./pyai-stt.provider.js";

/**
 * Exercises the retry loop itself, not just the classification.
 *
 * The classification was right twice while the wiring was wrong: HTTP statuses and job
 * errors were classified but a thrown fetch bypassed the loop entirely. A unit test of
 * the predicate would have passed throughout. This drives the provider.
 */
const config = {
  get: (key: string) =>
    ({
      PYAI_BASE_URL: "https://api.example.test/v1",
      PYAI_API_KEY: "test-key",
      PYAI_STT_MODEL: "pyai-hear",
      // Keep the poll and backoff windows short enough for a test.
      STT_REQUEST_TIMEOUT_MS: 20_000,
      TRANSPORT_RETRY_MAX: 3,
    })[key],
};

const provider = new PyAiSttProvider(config as never);
// Any readable file; the stub never inspects the bytes.
const request = {
  path: resolve(import.meta.dirname, "./pyai-stt.provider.ts"),
  mimeType: "audio/mpeg",
};

const completedJob = {
  status: "completed",
  result: {
    audio_seconds: 5,
    segments: [
      { start: 0, end: 5, text: "hello there", speaker: "speaker_1" },
    ],
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PyAiSttProvider transport retry", () => {
  it("retries a thrown fetch and succeeds on a later attempt", async () => {
    let creates = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "POST" && url.endsWith("/transcription/jobs")) {
          creates += 1;
          // The exact failure that reached the user: a bare network fault.
          if (creates === 1) throw new TypeError("fetch failed");
          return new Response(JSON.stringify({ job_id: "job_1" }), { status: 202 });
        }
        return new Response(JSON.stringify(completedJob), { status: 200 });
      }),
    );

    const result = await provider.transcribe(request);
    expect(creates).toBe(2);
    expect(result.segments).toHaveLength(1);
  });

  it("retries an engine 5xx reported on the job", async () => {
    let creates = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          creates += 1;
          return new Response(JSON.stringify({ job_id: `job_${creates}` }), {
            status: 202,
          });
        }
        if (creates === 1) {
          return new Response(
            JSON.stringify({
              status: "failed",
              error: "stt: HTTP 500: Internal Server Error",
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify(completedJob), { status: 200 });
      }),
    );

    const result = await provider.transcribe(request);
    expect(creates).toBe(2);
    expect(result.segments).toHaveLength(1);
  });

  it("gives up after the configured attempts rather than looping", async () => {
    let creates = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        creates += 1;
        throw new TypeError("fetch failed");
      }),
    );

    await expect(provider.transcribe(request)).rejects.toMatchObject({
      code: "internal_error",
    });
    expect(creates).toBe(3);
  });

  it("does not retry a quota failure — backoff cannot buy credit", async () => {
    let creates = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        creates += 1;
        return new Response(
          JSON.stringify({ error: { code: "daily_cap_exceeded" } }),
          { status: 429 },
        );
      }),
    );

    await expect(provider.transcribe(request)).rejects.toMatchObject({
      code: "internal_error",
    });
    expect(creates).toBe(1);
  });
});
