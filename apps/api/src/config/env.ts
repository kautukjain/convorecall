import { z } from "zod";
import { HARNESS_DEFAULTS, WORKER_DEFAULTS } from "@opengong/shared";

/**
 * Startup fails if configuration is missing or malformed. Defaults come from the config
 * tables in docs/Harness.md and docs/Jobs.md — this file must not invent its own.
 */
const numberFrom = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

export const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: numberFrom(3001),
  WEB_URL: z.string().url().default("http://localhost:3000"),

  // Required from Phase 1, when persistence lands.
  DATABASE_URL: z.string().optional(),

  // Model provider (ADR-003). Required from Phase 2.
  PYAI_API_KEY: z.string().optional(),
  PYAI_BASE_URL: z.string().url().optional(),
  PYAI_STT_MODEL: z.string().default("pyai-hear"),
  PYAI_LLM_MODEL: z.string().default("gpt-4o-mini"),

  // Extraction LLM (ADR-003). A separate capability entry: PyAI serves speech, not
  // chat completions, so this points at a different provider.
  LLM_BASE_URL: z.string().url().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("gpt-4o-mini"),

  /**
   * The LLM toggle. Off means PyAI alone — Hear for the transcript, Recap for the analysis, which is
   * what "runs on one API" requires. On means PyAI plus a model, where the model fills only what
   * Recap cannot evidence: next steps, intent without a buying signal, and the follow-up email.
   * Off by default so a fresh clone is one-API unless it opts out.
   */
  LLM_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),

  // Harness — docs/Harness.md
  JOB_DEADLINE_MS: numberFrom(HARNESS_DEFAULTS.JOB_DEADLINE_MS),
  JOB_TOKEN_BUDGET: numberFrom(HARNESS_DEFAULTS.JOB_TOKEN_BUDGET),
  LLM_REQUEST_TIMEOUT_MS: numberFrom(HARNESS_DEFAULTS.LLM_REQUEST_TIMEOUT_MS),
  STT_REQUEST_TIMEOUT_MS: numberFrom(HARNESS_DEFAULTS.STT_REQUEST_TIMEOUT_MS),
  TRANSPORT_RETRY_MAX: numberFrom(HARNESS_DEFAULTS.TRANSPORT_RETRY_MAX),
  SCHEMA_REPAIR_MAX: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(HARNESS_DEFAULTS.SCHEMA_REPAIR_MAX),
  EVIDENCE_MATCH_THRESHOLD: z.coerce
    .number()
    .min(0)
    .max(1)
    .default(HARNESS_DEFAULTS.EVIDENCE_MATCH_THRESHOLD),

  // Worker — docs/Jobs.md
  WORKER_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  WORKER_CONCURRENCY: numberFrom(WORKER_DEFAULTS.WORKER_CONCURRENCY),
  WORKER_POLL_INTERVAL_MS: numberFrom(WORKER_DEFAULTS.WORKER_POLL_INTERVAL_MS),
  WORKER_HEARTBEAT_MS: numberFrom(WORKER_DEFAULTS.WORKER_HEARTBEAT_MS),
  WORKER_STALE_AFTER_MS: numberFrom(WORKER_DEFAULTS.WORKER_STALE_AFTER_MS),
  JOB_MAX_ATTEMPTS: numberFrom(WORKER_DEFAULTS.JOB_MAX_ATTEMPTS),

  // Uploads — docs/API.md
  /**
   * 12 MB, not 100. Measured against the transcription provider: 9.2 MB transcribes
   * reliably, 18.3 MB returns a 503 at their gateway, 52.9 MB a hard 413. Advertising a
   * limit the provider will not honour just moves the failure later and makes it look
   * like our bug.
   */
  UPLOAD_MAX_BYTES: numberFrom(12_582_912),
  UPLOAD_MAX_DURATION_MS: numberFrom(7_200_000),
  /** Relative paths resolve from the API working directory. Never inside the web root. */
  STORAGE_DIR: z.string().min(1).default("../../.data/uploads"),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }
  return parsed.data;
}
