import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PROMPT_VERSION } from "@opengong/prompts";
import type { TranscriptSegment } from "@opengong/types";
import { CallNotesSchema } from "@opengong/validators";
import type { AiOrchestratorService } from "../ai/ai-orchestrator.service.js";
import { EvidenceService } from "../evidence/evidence.service.js";
import { NotesService } from "./notes.service.js";

const ROOT = resolve(import.meta.dirname, "../../../../..");
const segments = (
  JSON.parse(
    readFileSync(resolve(ROOT, "sample-data/transcripts/objection-call.json"), "utf8"),
  ) as { segments: TranscriptSegment[] }
).segments;

const noUsage = { promptTokens: 10, completionTokens: 10 };

function makeService(orchestrator: Partial<AiOrchestratorService>) {
  const config = { get: () => undefined };
  return new NotesService(
    orchestrator as AiOrchestratorService,
    new EvidenceService(config as never),
    config as never,
  );
}

const input = {
  callId: "call-1",
  segments,
  sttModel: null,
  tokenBudget: 120_000,
  deadlineAt: new Date(Date.now() + 600_000),
  startedAt: Date.now(),
};

describe("NotesService", () => {
  /**
   * The ADR-013 obligation. A claim that fails the gate must be invisible to the
   * derived sections, because they never receive the transcript — only survivors.
   */
  it("never shows a dropped claim to the derived sections", async () => {
    const synthesize = vi.fn(async () => ({
      ok: true as const,
      value: "derived text",
      usage: noUsage,
      model: "test",
    }));

    const service = makeService({
      isConfigured: () => true,
      extractClaims: vi.fn(async (section) =>
        section === "objections"
          ? {
              ok: true as const,
              usage: noUsage,
              model: "test",
              value: [
                {
                  claim: "Real: cannot justify pricing",
                  quote: "We're not sure we can justify that pricing right now.",
                },
                {
                  claim: "Invented: needs procurement approval",
                  quote: "We need approval from procurement before signing",
                },
              ],
            }
          : { ok: true as const, usage: noUsage, model: "test", value: [] },
      ) as never,
      synthesize: synthesize as never,
    });

    const outcome = await service.extract(input);

    expect(outcome.notes.metadata.droppedClaims).toBe(1);
    expect(outcome.notes.objections).toHaveLength(1);

    // The invented claim must not be in what the synthesizer was handed.
    const handed = JSON.stringify(synthesize.mock.calls[0]?.[1] ?? []);
    expect(handed).toContain("Real: cannot justify pricing");
    expect(handed).not.toContain("procurement");
  });

  it("returns partial when a claim was dropped", async () => {
    const service = makeService({
      isConfigured: () => true,
      extractClaims: vi.fn(async (section) => ({
        ok: true as const,
        usage: noUsage,
        model: "test",
        value:
          section === "objections"
            ? [
                {
                  claim: "ok",
                  quote: "We're not sure we can justify that pricing right now.",
                },
                { claim: "bad", quote: "totally fabricated statement here" },
              ]
            : [
                {
                  claim: "ok",
                  quote: "we'd need buy-in from finance, and Dave owns that",
                },
              ],
      })) as never,
      synthesize: vi.fn(async () => ({
        ok: true as const,
        value: "text",
        usage: noUsage,
        model: "test",
      })) as never,
    });

    const outcome = await service.extract(input);
    expect(outcome.exitStatus).toBe("partial");
  });

  it("returns deadline when the token budget is already spent", async () => {
    const service = makeService({
      isConfigured: () => true,
      extractClaims: vi.fn() as never,
      synthesize: vi.fn() as never,
    });

    const outcome = await service.extract({ ...input, tokenBudget: 0 });
    expect(outcome.exitStatus).toBe("deadline");
    // Budget is checked before spending, so nothing should have been called.
    expect(outcome.notes.metadata.droppedSections.length).toBeGreaterThan(0);
  });

  it("returns failed when every section is dropped", async () => {
    const service = makeService({
      isConfigured: () => true,
      extractClaims: vi.fn(async () => ({
        ok: false as const,
        reason: "schema_invalid_after_repair",
        usage: noUsage,
      })) as never,
      synthesize: vi.fn() as never,
    });

    const outcome = await service.extract(input);
    expect(outcome.exitStatus).toBe("failed");
    expect(outcome.notes.summary).toBe("");
  });

  it("records reproducibility metadata on every outcome", async () => {
    const service = makeService({
      isConfigured: () => true,
      extractClaims: vi.fn(async () => ({
        ok: true as const,
        usage: noUsage,
        model: "test-model",
        value: [
          {
            claim: "ok",
            quote: "We're not sure we can justify that pricing right now.",
          },
        ],
      })) as never,
      synthesize: vi.fn(async () => ({
        ok: true as const,
        value: "text",
        usage: noUsage,
        model: "test-model",
      })) as never,
    });

    const { notes } = await service.extract(input);
    // Against the constant, not a literal: the invariant is that notes record the prompt
    // version they were produced by, which is what makes a run reproducible.
    expect(notes.metadata.promptVersion).toBe(PROMPT_VERSION);
    expect(notes.metadata.llmModel).toBe("test-model");
    expect(notes.metadata.tokensUsed).toBeGreaterThan(0);
    expect(notes.metadata.generatedAt).toMatch(/^\d{4}-/);
  });

  /**
   * Regression: notes with no surviving intent must still be serveable.
   *
   * Absence used to be a blank `Evidence` — empty claim, empty quote, empty speaker, no segment ids.
   * It type-checked and it violated every rule `EvidenceSchema` states, so the moment intent actually
   * dropped, `CallNotesSchema` rejected the payload and `GET /calls/:id/notes` answered
   * `internal_error` on a job that had otherwise succeeded. The validator is asserted here directly,
   * because that is the boundary that failed — a shape the API cannot serialise is not a valid result.
   */
  it("serialises notes whose intent did not survive the gate", async () => {
    const service = makeService({
      isConfigured: () => true,
      // Only objections resolve; intent and next steps produce nothing that can be cited.
      extractClaims: vi.fn(async (section) => ({
        ok: true as const,
        usage: noUsage,
        model: "test-model",
        value:
          section === "objections"
            ? [
                // Verbatim from the fixture, so it survives the gate — the point of this test is a
                // null intent alongside a real objection, not a second dropped claim.
                { claim: "Pricing is the blocker", quote: "The issue is the number." },
              ]
            : [],
      })) as never,
      synthesize: vi.fn(async () => ({
        ok: true as const,
        value: "text",
        usage: noUsage,
        model: "test-model",
      })) as never,
    });

    const { notes } = await service.extract(input);

    expect(notes.intent).toBeNull();
    expect(notes.objections.length).toBeGreaterThan(0);
    expect(() => CallNotesSchema.parse(notes)).not.toThrow();
  });

  /**
   * The rows already on disk. Notes are persisted and every read path re-validates what it loaded, so
   * a payload written by the previous build — blank intent and all — has to stay readable or the call
   * answers `internal_error` for good. Normalised to null on the way in rather than migrated.
   */
  it("reads back a stored payload that used the old blank intent", async () => {
    const service = makeService({
      isConfigured: () => true,
      extractClaims: vi.fn(async (section) => ({
        ok: true as const,
        usage: noUsage,
        model: "test-model",
        value:
          section === "objections"
            ? [{ claim: "Pricing is the blocker", quote: "The issue is the number." }]
            : [],
      })) as never,
      synthesize: vi.fn(async () => ({
        ok: true as const,
        value: "text",
        usage: noUsage,
        model: "test-model",
      })) as never,
    });

    const { notes } = await service.extract(input);
    const legacy = {
      ...notes,
      intent: { claim: "", quote: "", segmentIds: [], startMs: 0, endMs: 0, speaker: "" },
    };

    const parsed = CallNotesSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.intent).toBeNull();
  });

  /**
   * Uncited next steps are a fallback, not a fixture of the page.
   *
   * With the model on, both sources answer this section — Recap with quoteless action items, the model
   * with cited ones — and forwarding both showed the same commitments twice, once with a timestamp and
   * once without. Whether the uncited copy appears therefore depends on what the gate kept, which is
   * why both directions are pinned here rather than just the happy one.
   */
  const uncitedSource = (nextStepQuote: string | null) => ({
    isConfigured: () => true,
    uncited: () => ({
      source: "pyai-recap",
      actionItems: [{ task: "Send one-page summary to Dave from finance", owner: "agent" }],
      keyDecisions: ["Six-month term instead of annual"],
    }),
    extractClaims: vi.fn(async (section) => ({
      ok: true as const,
      usage: noUsage,
      model: "test-model",
      value:
        section === "nextSteps" && nextStepQuote
          ? [{ claim: "Rep will send a one-pager", quote: nextStepQuote }]
          : [],
    })) as never,
    synthesize: vi.fn(async () => ({
      ok: true as const,
      value: "text",
      usage: noUsage,
      model: "test-model",
    })) as never,
  });

  it("keeps uncited action items when nothing cited covers them", async () => {
    const service = makeService(uncitedSource(null));
    const { notes } = await service.extract(input);

    expect(notes.nextSteps).toHaveLength(0);
    expect(notes.uncited?.actionItems).toHaveLength(1);
  });

  it("drops uncited action items once a cited next step survives, but keeps the decisions", async () => {
    // Verbatim from the fixture, so the model's next step passes the gate.
    const service = makeService(
      uncitedSource("So I'll do a one-pager, the offset and the time math."),
    );
    const { notes } = await service.extract(input);

    expect(notes.nextSteps.length).toBeGreaterThan(0);
    expect(notes.uncited?.actionItems).toEqual([]);
    // Decisions have no evidenced counterpart — deduplicating must not silently discard them.
    expect(notes.uncited?.keyDecisions).toEqual(["Six-month term instead of annual"]);
  });
});
