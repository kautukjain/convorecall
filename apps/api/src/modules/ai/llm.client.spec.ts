import { describe, expect, it } from "vitest";
import { isRetryable } from "./llm.client.js";

describe("isRetryable", () => {
  it("retries transient server and rate-limit failures", () => {
    expect(isRetryable(429, '{"error":{"code":"rate_limit_exceeded"}}')).toBe(true);
    expect(isRetryable(500, "boom")).toBe(true);
    expect(isRetryable(502, "")).toBe(true);
    expect(isRetryable(503, "")).toBe(true);
    expect(isRetryable(408, "")).toBe(true);
  });

  /**
   * A 429 can mean "slow down" or "you are out of credit". Backoff fixes the first and
   * only delays the second, burying the real cause behind the full retry budget.
   */
  it("does not retry a 429 that means the account is out of credit", () => {
    expect(
      isRetryable(
        429,
        '{"error":{"message":"You have no credits remaining.","type":"insufficient_quota","code":"credit_balance_exhausted"}}',
      ),
    ).toBe(false);
    expect(isRetryable(429, "exceeded your current quota")).toBe(false);
    expect(isRetryable(429, '{"error":{"type":"billing_error"}}')).toBe(false);
  });

  it("never retries a client error it cannot fix", () => {
    expect(isRetryable(400, "bad request")).toBe(false);
    expect(isRetryable(401, "unauthorized")).toBe(false);
    expect(isRetryable(403, "forbidden")).toBe(false);
    expect(isRetryable(404, "unknown_route")).toBe(false);
  });
});
