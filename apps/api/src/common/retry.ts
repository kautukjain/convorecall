/**
 * The transport retry class (ADR-007, docs/Harness.md).
 *
 * One definition, used by every provider call. It lived only inside the LLM client for a
 * while, which meant the documented policy — "timeout, 429, 5xx, network error" — was
 * true of extraction and silently untrue of speech-to-text.
 */

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/**
 * A 429 usually means "slow down" and is worth retrying. It can also mean "you are out
 * of credit", which no amount of backoff fixes — retrying that just delays the failure
 * by the full backoff budget and buries the real cause.
 */
const PERMANENT =
  /insufficient_quota|credit_balance_exhausted|daily_cap_exceeded|sandbox_limit_reached|billing|payment|exceeded your current quota/i;

export function isRetryable(status: number, body: string): boolean {
  if (PERMANENT.test(body)) return false;
  return RETRYABLE_STATUS.has(status);
}

/**
 * Whether an async job that came back `failed` is worth resubmitting. Providers report
 * an engine fault as free text rather than a status code, so this reads the text.
 */
export function isRetryableJobError(error: string | undefined): boolean {
  if (!error) return false;
  if (PERMANENT.test(error)) return false;
  return /\b5\d\d\b|internal server error|timeout|timed out|temporarily|unavailable|try again/i.test(
    error,
  );
}

/** Exponential with jitter: roughly 1s, 2s, 4s. */
export async function backoff(attempt: number): Promise<void> {
  const base = 1_000 * 2 ** (attempt - 1);
  const jitter = Math.floor(base * 0.25 * Math.random());
  await new Promise((done) => setTimeout(done, base + jitter));
}

/**
 * `fetch failed` on its own says nothing. undici hides the real reason — ECONNRESET,
 * ETIMEDOUT, EAI_AGAIN, a TLS fault — one level down in `cause`, so unwrap it before
 * logging or the operator detail is worthless.
 */
export function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const parts = [error.message];
  let cause: unknown = (error as { cause?: unknown }).cause;
  let depth = 0;
  while (cause instanceof Error && depth < 3) {
    const code = (cause as { code?: string }).code;
    parts.push(code ? `${cause.message} (${code})` : cause.message);
    cause = (cause as { cause?: unknown }).cause;
    depth += 1;
  }
  return parts.join(" <- ");
}

/**
 * A thrown fetch — as opposed to an HTTP error response — is a connection fault or an
 * abort. Both are transient by definition and are the third trigger in the transport
 * retry class, alongside timeouts and 5xx.
 */
export function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError" || error.name === "TimeoutError") return true;
  return /fetch failed|network|socket|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|terminated/i.test(
    describeNetworkError(error),
  );
}
