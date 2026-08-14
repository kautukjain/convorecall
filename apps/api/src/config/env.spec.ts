import { describe, expect, it } from "vitest";
import { validateEnv } from "./env.js";

describe("validateEnv", () => {
  it("applies documented defaults when optional keys are absent", () => {
    const env = validateEnv({});
    expect(env.PORT).toBe(3001);
    expect(env.JOB_DEADLINE_MS).toBe(900_000);
    expect(env.EVIDENCE_MATCH_THRESHOLD).toBe(0.85);
    expect(env.TRANSPORT_RETRY_MAX).toBe(3);
    expect(env.SCHEMA_REPAIR_MAX).toBe(1);
  });

  it("coerces numeric strings from the environment", () => {
    const env = validateEnv({ PORT: "4000", WORKER_CONCURRENCY: "8" });
    expect(env.PORT).toBe(4000);
    expect(env.WORKER_CONCURRENCY).toBe(8);
  });

  it("treats WORKER_ENABLED as the worker split seam (docs/Jobs.md)", () => {
    expect(validateEnv({}).WORKER_ENABLED).toBe(true);
    expect(validateEnv({ WORKER_ENABLED: "false" }).WORKER_ENABLED).toBe(false);
  });

  it("fails fast on a malformed value rather than silently defaulting", () => {
    expect(() => validateEnv({ PORT: "not-a-port" })).toThrow(
      /Invalid environment configuration/,
    );
    expect(() => validateEnv({ EVIDENCE_MATCH_THRESHOLD: "2" })).toThrow(
      /Invalid environment configuration/,
    );
  });
});
