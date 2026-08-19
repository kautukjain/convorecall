import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureSandboxKey,
  mintSandboxKey,
  readEnvValue,
  setEnvValue,
} from "./sandbox-key.js";

const EXAMPLE = [
  "NODE_ENV=development",
  "PYAI_API_KEY=",
  "PYAI_BASE_URL=https://api.pyai.com/v1",
  "LLM_MODEL=gpt-4o-mini",
  "",
].join("\n");

/** The shape observed from a real `201`, trimmed to the fields the parser reads. */
const MINTED = {
  object: "sandbox.key",
  api_key: "pyai_test_abc123",
  expires_at: 1787219269113,
  scopes: ["hear:transcribe", "hear:stream", "voice:synthesize"],
};

function envFile(contents: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), "convorecall-env-"));
  const path = resolve(dir, ".env");
  writeFileSync(path, contents);
  return path;
}

function stubFetch(status: number, body: unknown): typeof fetch {
  return (() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    })) as unknown as typeof fetch;
}

describe("readEnvValue", () => {
  it("reads a set value and treats an empty one as absent", () => {
    expect(readEnvValue(EXAMPLE, "PYAI_BASE_URL")).toBe("https://api.pyai.com/v1");
    expect(readEnvValue(EXAMPLE, "PYAI_API_KEY")).toBeNull();
    expect(readEnvValue(EXAMPLE, "NOT_THERE")).toBeNull();
  });
});

describe("setEnvValue", () => {
  it("replaces one line and leaves every other byte alone", () => {
    const next = setEnvValue(EXAMPLE, "PYAI_API_KEY", "pyai_test_x");
    expect(next).toContain("PYAI_API_KEY=pyai_test_x");
    expect(next).toContain("LLM_MODEL=gpt-4o-mini");
    expect(next.split("\n")).toHaveLength(EXAMPLE.split("\n").length);
  });

  it("appends when the key is absent, keeping the file newline-terminated", () => {
    expect(setEnvValue("A=1\n", "PYAI_API_KEY", "k")).toBe("A=1\nPYAI_API_KEY=k\n");
    expect(setEnvValue("A=1", "PYAI_API_KEY", "k")).toBe("A=1\nPYAI_API_KEY=k\n");
  });
});

describe("mintSandboxKey", () => {
  it("parses the observed success payload", async () => {
    const minted = await mintSandboxKey("https://api.pyai.com/v1", stubFetch(201, MINTED));
    expect(minted?.apiKey).toBe("pyai_test_abc123");
    expect(minted?.scopeCount).toBe(3);
    expect(minted?.expiresAt?.toISOString().slice(0, 10)).toBe("2026-08-20");
  });

  it("returns null on the documented per-network rate limit", async () => {
    const body = { error: { code: "sandbox_limit_reached" } };
    expect(await mintSandboxKey("https://api.pyai.com/v1", stubFetch(429, body))).toBeNull();
  });

  it("returns null when the payload has no api_key, rather than writing junk", async () => {
    expect(
      await mintSandboxKey("https://api.pyai.com/v1", stubFetch(201, { object: "x" })),
    ).toBeNull();
  });

  it("returns null when the request throws", async () => {
    const boom = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    expect(await mintSandboxKey("https://api.pyai.com/v1", boom)).toBeNull();
  });
});

describe("ensureSandboxKey", () => {
  /**
   * The rule that matters most. Clobbering a working credential during setup is a worse
   * failure than never minting one, so this test guards the developer's own key.
   */
  it("never touches an existing key", async () => {
    const path = envFile(EXAMPLE.replace("PYAI_API_KEY=", "PYAI_API_KEY=mine-do-not-touch"));
    const before = readFileSync(path, "utf8");

    const outcome = await ensureSandboxKey(path, {
      fetchImpl: (() => {
        throw new Error("must not call the mint endpoint when a key is present");
      }) as unknown as typeof fetch,
    });

    expect(outcome.status).toBe("present");
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("mints into an empty key line", async () => {
    const path = envFile(EXAMPLE);
    const outcome = await ensureSandboxKey(path, { fetchImpl: stubFetch(201, MINTED) });

    expect(outcome.status).toBe("minted");
    expect(readEnvValue(readFileSync(path, "utf8"), "PYAI_API_KEY")).toBe("pyai_test_abc123");
    // The secret must never reach a log line, not even truncated.
    expect(outcome.message).not.toContain("pyai_test_abc123");
    expect(outcome.message).toContain("2026-08-20");
  });

  it("leaves the file untouched and stays non-fatal when minting fails", async () => {
    const path = envFile(EXAMPLE);
    const outcome = await ensureSandboxKey(path, { fetchImpl: stubFetch(429, {}) });

    expect(outcome.status).toBe("failed");
    expect(readFileSync(path, "utf8")).toBe(EXAMPLE);
    if (outcome.status === "failed") expect(outcome.hint).toContain("curl -X POST");
  });

  it("skips when there is no .env at all", async () => {
    const outcome = await ensureSandboxKey(resolve(tmpdir(), "convorecall-nope", ".env"));
    expect(outcome.status).toBe("skipped");
  });
});
