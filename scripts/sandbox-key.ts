import { readFileSync, writeFileSync } from "node:fs";

/**
 * Mints the free PyAI sandbox key during `pnpm setup`, so a fresh clone can transcribe its
 * own audio without going to find a credential first (`docs/Deployment.md`).
 *
 * `docs/Deployment.md` previously recorded this as deliberately un-wired, because the success
 * payload had never been observed and "parsing a response shape nobody has seen is how you
 * break a fresh clone's first five minutes". That was the right call at the time. The shape
 * has since been observed directly — `201` with `api_key`, `expires_at`, and `scopes` — so the
 * parser below is written against a real response rather than a guess.
 *
 * Two rules this module will not bend:
 *
 * 1. **An existing key is never touched.** Overwriting a working credential during a setup
 *    script is a far worse failure than not having one.
 * 2. **Failure is never fatal.** The endpoint is rate limited per network and returns
 *    `429 sandbox_limit_reached` once a network's quota is spent. A setup script that dies
 *    because a third party is busy is worse than one that tells you what to paste.
 *
 * The key is a secret: it is written to `.env` and never printed, not even partially.
 */

const DEFAULT_BASE_URL = "https://api.pyai.com/v1";
const ENV_KEY = "PYAI_API_KEY";

export type MintedKey = {
  apiKey: string;
  /** Sandbox keys expire — observed at seven days. Null when the field is absent. */
  expiresAt: Date | null;
  scopeCount: number;
};

export type Outcome =
  | { status: "present"; message: string }
  | { status: "minted"; message: string; expiresAt: Date | null }
  | { status: "skipped"; message: string }
  | { status: "failed"; message: string; hint: string };

/** Reads a single value out of `.env` text. Returns null when absent or empty. */
export function readEnvValue(text: string, key: string): string | null {
  const match = new RegExp(`^${key}=(.*)$`, "m").exec(text);
  const value = match?.[1]?.trim();
  return value ? value : null;
}

/**
 * Sets one value, leaving every other byte of the file alone. A setup script that rewrites
 * `.env` wholesale would silently discard whatever the developer had already configured.
 */
export function setEnvValue(text: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(text)) return text.replace(pattern, line);
  // Absent entirely: append, keeping the file newline-terminated.
  const separator = text.length === 0 || text.endsWith("\n") ? "" : "\n";
  return `${text}${separator}${line}\n`;
}

/**
 * Calls the documented mint endpoint. Returns null on any failure — a non-2xx, a timeout, a
 * payload without `api_key`, or anything thrown.
 */
export async function mintSandboxKey(
  baseUrl: string = DEFAULT_BASE_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<MintedKey | null> {
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/sandbox/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "opengong-lite" }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as {
      api_key?: unknown;
      expires_at?: unknown;
      scopes?: unknown;
    };

    // The one field that matters. Anything else is nice to report and not load-bearing.
    if (typeof payload.api_key !== "string" || payload.api_key.length === 0) return null;

    return {
      apiKey: payload.api_key,
      expiresAt:
        typeof payload.expires_at === "number"
          ? new Date(payload.expires_at)
          : null,
      scopeCount: Array.isArray(payload.scopes) ? payload.scopes.length : 0,
    };
  } catch {
    return null;
  }
}

const HINT =
  `Mint one by hand and paste it into .env as ${ENV_KEY}:\n` +
  `    curl -X POST ${DEFAULT_BASE_URL}/sandbox/keys \\\n` +
  `      -H 'content-type: application/json' -d '{"label":"opengong-lite"}'\n` +
  "  Speech-to-text needs it. The five sample calls do not — they ship written transcripts.";

/**
 * Ensures `.env` carries a speech-to-text key, minting one only when it is genuinely absent.
 */
export async function ensureSandboxKey(
  envPath: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<Outcome> {
  let text: string;
  try {
    text = readFileSync(envPath, "utf8");
  } catch {
    return { status: "skipped", message: "No .env to write a key into." };
  }

  if (readEnvValue(text, ENV_KEY)) {
    return { status: "present", message: `${ENV_KEY} already set, leaving it alone.` };
  }

  const baseUrl = readEnvValue(text, "PYAI_BASE_URL") ?? DEFAULT_BASE_URL;
  const minted = await mintSandboxKey(baseUrl, options.fetchImpl);

  if (!minted) {
    return {
      status: "failed",
      message: "Could not mint a sandbox key (the endpoint is rate limited per network).",
      hint: HINT,
    };
  }

  writeFileSync(envPath, setEnvValue(text, ENV_KEY, minted.apiKey));

  const expiry = minted.expiresAt
    ? ` It expires ${minted.expiresAt.toISOString().slice(0, 10)} — re-run \`pnpm setup\` after that.`
    : "";
  return {
    status: "minted",
    // Never the key itself, not even a prefix.
    message: `Minted a free PyAI sandbox key into .env (${minted.scopeCount} scopes).${expiry}`,
    expiresAt: minted.expiresAt,
  };
}
