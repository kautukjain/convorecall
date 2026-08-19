import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureLlm } from "./llm-setup.js";
import { readEnvValue } from "./sandbox-key.js";

const BLANK = [
  "PYAI_API_KEY=pyai_test_x",
  "LLM_BASE_URL=",
  "LLM_API_KEY=",
  "LLM_MODEL=",
  "WORKER_ENABLED=true",
  "",
].join("\n");

function envFile(contents: string): string {
  const path = resolve(mkdtempSync(resolve(tmpdir(), "convorecall-llm-")), ".env");
  writeFileSync(path, contents);
  return path;
}

/** Answers only for the given base URL; everything else behaves like a closed port. */
function runnerAt(baseUrl: string, models: string[]): typeof fetch {
  return ((url: string) => {
    if (!String(url).startsWith(baseUrl)) return Promise.reject(new Error("ECONNREFUSED"));
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ data: models.map((id) => ({ id })) }),
    });
  }) as unknown as typeof fetch;
}

const nothingRunning = (() =>
  Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch;

describe("ensureLlm", () => {
  it("leaves an already-configured endpoint alone", async () => {
    const path = envFile(
      BLANK.replace("LLM_BASE_URL=", "LLM_BASE_URL=https://openrouter.ai/api/v1")
        .replace("LLM_API_KEY=", "LLM_API_KEY=sk-secret")
        .replace("LLM_MODEL=", "LLM_MODEL=google/gemma-4-31b-it"),
    );
    const before = readFileSync(path, "utf8");

    const outcome = await ensureLlm(path, {
      fetchImpl: (() => {
        throw new Error("must not probe when already configured");
      }) as unknown as typeof fetch,
    });

    expect(outcome.status).toBe("configured");
    expect(readFileSync(path, "utf8")).toBe(before);
    // The key must never reach a log line, and the base URL is reported by host only.
    expect(outcome.message).not.toContain("sk-secret");
    expect(outcome.message).toContain("openrouter.ai");
  });

  it("wires up a local runner when one is serving models", async () => {
    const path = envFile(BLANK);
    const outcome = await ensureLlm(path, {
      fetchImpl: runnerAt("http://localhost:11434/v1", ["llama3.2", "qwen2.5"]),
    });

    expect(outcome.status).toBe("local");
    const written = readFileSync(path, "utf8");
    expect(readEnvValue(written, "LLM_BASE_URL")).toBe("http://localhost:11434/v1");
    expect(readEnvValue(written, "LLM_API_KEY")).toBe("local");
    expect(readEnvValue(written, "LLM_MODEL")).toBe("llama3.2");
    // Everything else in the file survives.
    expect(readEnvValue(written, "PYAI_API_KEY")).toBe("pyai_test_x");
  });

  it("ignores a runner that is up but holds no model", async () => {
    const path = envFile(BLANK);
    const outcome = await ensureLlm(path, {
      fetchImpl: runnerAt("http://localhost:11434/v1", []),
    });

    expect(outcome.status).toBe("absent");
    expect(readFileSync(path, "utf8")).toBe(BLANK);
  });

  /**
   * The case that matters for a fresh clone: no key, nothing local, and setup must still be a
   * success — because the sample calls replay a recorded extraction (ADR-016).
   */
  it("reports absent without failing, and says the samples still work", async () => {
    const path = envFile(BLANK);
    const outcome = await ensureLlm(path, { fetchImpl: nothingRunning });

    expect(outcome.status).toBe("absent");
    expect(readFileSync(path, "utf8")).toBe(BLANK);
    if (outcome.status === "absent") {
      expect(outcome.hint).toMatch(/sample calls need no key/i);
    }
  });
});
