import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ProblemException } from "../../common/problem.js";

export type ChatMessage = { role: "system" | "user"; content: string };

export type ChatResult = {
  content: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
};

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
};

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/**
 * A 429 usually means "slow down" and is worth retrying. It can also mean "you are out
 * of credit", which no amount of backoff fixes — retrying that just delays the failure
 * by the full backoff budget and buries the real cause.
 */
const PERMANENT_429 = /insufficient_quota|credit_balance_exhausted|billing|payment|exceeded your current quota/i;

export function isRetryable(status: number, body: string): boolean {
  if (!RETRYABLE_STATUS.has(status)) return false;
  if (status === 429 && PERMANENT_429.test(body)) return false;
  return true;
}

/**
 * OpenAI-compatible chat client (ADR-003).
 *
 * Owns **transport retry only** — timeouts, rate limits, and 5xx, bounded and backed off
 * (docs/Harness.md). Schema repair is a different mechanism with a different budget and
 * lives in the orchestrator; conflating them is what made the original rules contradict
 * each other.
 */
@Injectable()
export class LlmClient {
  private readonly logger = new Logger(LlmClient.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>("LLM_BASE_URL") &&
        this.config.get<string>("LLM_API_KEY"),
    );
  }

  async chat(messages: ChatMessage[], temperature = 0.2): Promise<ChatResult> {
    const baseUrl = this.config.get<string>("LLM_BASE_URL");
    const apiKey = this.config.get<string>("LLM_API_KEY");
    const model = this.config.get<string>("LLM_MODEL") ?? "gpt-4o-mini";

    if (!baseUrl || !apiKey) {
      throw new ProblemException(
        "internal_error",
        "Extraction is not configured.",
        "LLM_BASE_URL or LLM_API_KEY is unset. PyAI serves speech, not chat completions — " +
          "extraction needs a separate OpenAI-compatible endpoint (ADR-003).",
      );
    }

    const maxAttempts = this.config.get<number>("TRANSPORT_RETRY_MAX") ?? 3;
    const timeoutMs = this.config.get<number>("LLM_REQUEST_TIMEOUT_MS") ?? 30_000;
    const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

    let lastError = "";
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages,
            temperature,
            response_format: { type: "json_object" },
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!response.ok) {
          const detail = (await response.text()).slice(0, 500);
          if (isRetryable(response.status, detail) && attempt < maxAttempts) {
            lastError = `${response.status}: ${detail}`;
            await this.backoff(attempt);
            continue;
          }
          throw new ProblemException(
            "internal_error",
            "Extraction failed.",
            `LLM returned ${response.status}: ${detail}`,
          );
        }

        const payload = (await response.json()) as ChatCompletionResponse;
        const content = payload.choices?.[0]?.message?.content;
        if (!content) {
          throw new ProblemException(
            "internal_error",
            "Extraction failed.",
            "LLM returned no message content",
          );
        }

        return {
          content,
          promptTokens: payload.usage?.prompt_tokens ?? 0,
          completionTokens: payload.usage?.completion_tokens ?? 0,
          model: payload.model ?? model,
        };
      } catch (error) {
        if (error instanceof ProblemException) throw error;

        // Timeouts and network failures are transient by definition.
        const message = error instanceof Error ? error.message : String(error);
        lastError = message;
        if (attempt >= maxAttempts) break;
        this.logger.warn(`LLM attempt ${attempt} failed (${message}); retrying`);
        await this.backoff(attempt);
      }
    }

    throw new ProblemException(
      "internal_error",
      "Extraction failed.",
      `LLM exhausted ${maxAttempts} transport attempts: ${lastError}`,
    );
  }

  /** Exponential with jitter: 1s, 2s, 4s. */
  private async backoff(attempt: number): Promise<void> {
    const base = 1_000 * 2 ** (attempt - 1);
    const jitter = Math.floor(base * 0.25 * Math.random());
    await new Promise((done) => setTimeout(done, base + jitter));
  }
}
