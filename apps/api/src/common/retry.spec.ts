import { describe, expect, it } from "vitest";
import {
  describeNetworkError,
  isNetworkFailure,
  isRetryable,
  isRetryableJobError,
} from "./retry.js";

describe("isRetryable", () => {
  it("retries transient transport failures", () => {
    expect(isRetryable(429, "rate_limit_exceeded")).toBe(true);
    expect(isRetryable(500, "")).toBe(true);
    expect(isRetryable(503, "upstream connect error")).toBe(true);
  });

  /** Backoff cannot buy credit. Retrying only delays the real cause. */
  it("never retries a quota or billing failure", () => {
    expect(isRetryable(429, '{"code":"daily_cap_exceeded"}')).toBe(false);
    expect(isRetryable(429, '{"type":"insufficient_quota"}')).toBe(false);
    expect(isRetryable(403, "sandbox_limit_reached")).toBe(false);
  });

  it("never retries a client error it cannot fix", () => {
    expect(isRetryable(400, "bad request")).toBe(false);
    expect(isRetryable(401, "unauthorized")).toBe(false);
    expect(isRetryable(404, "unknown_route")).toBe(false);
  });
});

/**
 * Async providers report an engine fault as free text on a job, not as a status code,
 * so the classification has to read the message. These are the strings actually observed
 * from the transcription engine.
 */
describe("isRetryableJobError", () => {
  it("retries an engine fault", () => {
    expect(isRetryableJobError("stt: HTTP 500: Internal Server Error")).toBe(true);
    expect(
      isRetryableJobError(
        "stt: HTTP 503: upstream connect error or disconnect/reset before headers",
      ),
    ).toBe(true);
    expect(isRetryableJobError("engine timed out")).toBe(true);
  });

  it("does not retry a quota failure reported on the job", () => {
    expect(isRetryableJobError("daily_cap_exceeded")).toBe(false);
  });

  it("does not retry a fault it cannot classify", () => {
    expect(isRetryableJobError("unsupported audio format")).toBe(false);
    expect(isRetryableJobError(undefined)).toBe(false);
    expect(isRetryableJobError("")).toBe(false);
  });
});

/**
 * The third transport-retry trigger. It was the one left unimplemented: HTTP statuses
 * and job errors were classified, but a thrown fetch went straight past the retry loop
 * and failed the job on the first blip.
 */
describe("isNetworkFailure", () => {
  it("treats a thrown fetch as transient", () => {
    expect(isNetworkFailure(new TypeError("fetch failed"))).toBe(true);
  });

  it("unwraps the cause undici hides", () => {
    const cause = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    const error = Object.assign(new TypeError("fetch failed"), { cause });
    expect(isNetworkFailure(error)).toBe(true);
    expect(describeNetworkError(error)).toContain("ECONNRESET");
  });

  it("treats an abort or timeout as transient", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    expect(isNetworkFailure(abort)).toBe(true);
    expect(isNetworkFailure(timeout)).toBe(true);
  });

  it("does not treat a programming mistake as transient", () => {
    expect(isNetworkFailure(new TypeError("x is not a function"))).toBe(false);
    expect(isNetworkFailure(new RangeError("out of range"))).toBe(false);
    expect(isNetworkFailure("just a string")).toBe(false);
  });
});
