import { readFileSync, writeFileSync } from "node:fs";
import { readEnvValue, setEnvValue } from "./sandbox-key.js";

/**
 * Reports — and where possible configures — the extraction endpoint during `pnpm setup`.
 *
 * Speech and text are provisioned very differently, and pretending otherwise is what made the
 * "five-minute setup" claim shaky. PyAI mints a sandbox key with no account, so
 * `scripts/sandbox-key.ts` can finish that job unattended. **No OpenAI-compatible text provider
 * does that** — OpenRouter, OpenAI and the rest all require a signed-up account before a key
 * exists, so there is nothing for a setup script to call.
 *
 * That would be a blocker if extraction were needed to see the product. It is not: the five
 * sample calls replay a recorded extraction through the real evidence gate (ADR-016), so a fresh
 * clone demos with no text key at all. A key is needed only to analyse audio of your own.
 *
 * There is exactly one keyless path to real extraction, and it is worth taking automatically: a
 * local OpenAI-compatible runner. Ollama and LM Studio both serve `/v1` with no credential, so
 * if one is already running this wires it up and the setup finishes genuinely complete.
 */

/** Local runners that speak the OpenAI shape without a credential. */
const LOCAL_RUNNERS = [
  { label: "Ollama", baseUrl: "http://localhost:11434/v1" },
  { label: "LM Studio", baseUrl: "http://localhost:1234/v1" },
] as const;

/** A placeholder: local runners ignore it, and the client requires the field to be non-empty. */
const LOCAL_KEY = "local";

export type LlmOutcome =
  | { status: "configured"; message: string }
  | { status: "local"; message: string }
  | { status: "absent"; message: string; hint: string };

const HINT =
  "The five sample calls need no key — they replay a recorded extraction (ADR-016).\n" +
  "  To analyse your own audio, set LLM_BASE_URL and LLM_API_KEY in .env to any\n" +
  "  OpenAI-compatible endpoint (ADR-003), or start Ollama and re-run `pnpm setup`.";

/**
 * Asks a local runner what it can serve. A short timeout on purpose: this runs on every setup,
 * and nobody should wait on a port that has nothing behind it.
 */
async function probe(
  baseUrl: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  try {
    const response = await fetchImpl(`${baseUrl}/models`, {
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as { data?: Array<{ id?: unknown }> };
    const first = payload.data?.find((model) => typeof model.id === "string");
    // A runner that is up but holds no model cannot serve extraction, so it is not a hit.
    return typeof first?.id === "string" ? first.id : null;
  } catch {
    return null;
  }
}

export async function ensureLlm(
  envPath: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<LlmOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;

  let text: string;
  try {
    text = readFileSync(envPath, "utf8");
  } catch {
    return { status: "absent", message: "No .env to configure.", hint: HINT };
  }

  const baseUrl = readEnvValue(text, "LLM_BASE_URL");
  const apiKey = readEnvValue(text, "LLM_API_KEY");
  if (baseUrl && apiKey) {
    const model = readEnvValue(text, "LLM_MODEL") ?? "default model";
    return {
      status: "configured",
      // Never the key, and only the host of the URL — a base URL can carry a token in its path.
      message: `Extraction is configured (${new URL(baseUrl).host}, ${model}).`,
    };
  }

  for (const runner of LOCAL_RUNNERS) {
    const model = await probe(runner.baseUrl, fetchImpl);
    if (!model) continue;

    let next = setEnvValue(text, "LLM_BASE_URL", runner.baseUrl);
    next = setEnvValue(next, "LLM_API_KEY", LOCAL_KEY);
    next = setEnvValue(next, "LLM_MODEL", model);
    writeFileSync(envPath, next);

    return {
      status: "local",
      message: `Found ${runner.label} running locally and pointed extraction at it (${model}). No key needed.`,
    };
  }

  return {
    status: "absent",
    message: "Extraction is not configured, which the sample calls do not need.",
    hint: HINT,
  };
}
