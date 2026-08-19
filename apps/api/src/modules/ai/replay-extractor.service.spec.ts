import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { TranscriptSegment } from "@convorecall/types";
import { EvidenceService } from "../evidence/evidence.service.js";
import { NotesService } from "../notes/notes.service.js";
import type { AiOrchestratorService } from "./ai-orchestrator.service.js";
import { ReplayExtractorService } from "./replay-extractor.service.js";

const ROOT = resolve(import.meta.dirname, "../../../../..");
const FIXTURE = "objection-call";

const segments = (
  JSON.parse(
    readFileSync(resolve(ROOT, `sample-data/transcripts/${FIXTURE}.json`), "utf8"),
  ) as { segments: TranscriptSegment[] }
).segments;

// Recordings resolve relative to the API working directory, like fixture transcripts do.
// The service reads cwd when it is constructed, so it must be built after the chdir — not
// at module load, which happens first and would bake in vitest's repo-root cwd.
let service: ReplayExtractorService;

beforeAll(() => {
  process.chdir(resolve(import.meta.dirname, "../../.."));
  service = new ReplayExtractorService();
});

describe("ReplayExtractorService.load", () => {
  it("returns null when no recording exists, so the caller can fail honestly", async () => {
    expect(await service.load("no-such-call")).toBeNull();
  });

  it("refuses a traversing fixture name", async () => {
    expect(await service.load("../../../etc/passwd")).toBeNull();
  });

  it("replays recorded claims without spending tokens", async () => {
    const source = await service.load(FIXTURE);
    expect(source).not.toBeNull();

    const result = await source!.extractClaims("objections", []);
    expect(result.ok).toBe(true);
    // Replay must never be mistaken for a live call in the budget accounting.
    expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0 });
    if (result.ok) {
      // Names the replay, so an export cannot imply a model produced this.
      expect(result.model).toBe(`replay:${FIXTURE}`);
      expect(result.value.length).toBeGreaterThan(0);
      for (const candidate of result.value) {
        expect(candidate.claim).toBeTruthy();
        expect(candidate.quote).toBeTruthy();
      }
    }
  });
});

describe("the offline demo path", () => {
  /**
   * The obligation that makes replay safe to demo: a replayed claim is gated exactly like a
   * live one. If this ever passes while the gate is bypassed, the offline demo has become a
   * slideshow and the product's whole premise is unverified on the screen people watch.
   */
  it("runs recorded claims through the real evidence gate", async () => {
    const source = await service.load(FIXTURE);
    const config = { get: () => undefined };
    const notes = new NotesService(
      // Present only to prove it is never consulted: any call throws.
      {
        extractClaims: () => {
          throw new Error("live model must not be called on the offline path");
        },
        synthesize: () => {
          throw new Error("live model must not be called on the offline path");
        },
      } as unknown as AiOrchestratorService,
      new EvidenceService(config as never),
      config as never,
    );

    const outcome = await notes.extract({
      callId: "call-offline",
      segments,
      sttModel: null,
      tokenBudget: 120_000,
      deadlineAt: new Date(Date.now() + 600_000),
      startedAt: Date.now(),
      source: source!,
    });

    expect(outcome.tokensUsed).toBe(0);
    expect(outcome.llmModel).toBe(`replay:${FIXTURE}`);
    expect(["shipped", "partial"]).toContain(outcome.exitStatus);

    // Every surviving claim carries a real position, which only the matcher can supply.
    const evidenced = [
      ...(outcome.notes.intent ? [outcome.notes.intent] : []),
      ...outcome.notes.objections,
      ...outcome.notes.nextSteps,
    ].filter((entry) => entry.claim);

    expect(evidenced.length).toBeGreaterThan(0);
    for (const entry of evidenced) {
      expect(entry.segmentIds.length).toBeGreaterThan(0);
      expect(entry.speaker).toBeTruthy();
      // The quote resolved against this transcript, not some other call's.
      expect(segments.some((segment) => entry.segmentIds.includes(segment.id))).toBe(true);
    }

    expect(outcome.notes.summary).toBeTruthy();
    expect(outcome.notes.followUpEmail).toBeTruthy();
  });

  it("drops a recorded claim whose quote does not resolve", async () => {
    const config = { get: () => undefined };
    const notes = new NotesService(
      {} as AiOrchestratorService,
      new EvidenceService(config as never),
      config as never,
    );

    const outcome = await notes.extract({
      callId: "call-offline",
      segments,
      sttModel: null,
      tokenBudget: 120_000,
      deadlineAt: new Date(Date.now() + 600_000),
      startedAt: Date.now(),
      source: {
        extractClaims: (section) =>
          Promise.resolve(
            section === "objections"
              ? {
                  ok: true as const,
                  value: [
                    { claim: "Invented", quote: "a sentence nobody said on this call" },
                  ],
                  usage: { promptTokens: 0, completionTokens: 0 },
                  model: "replay:test",
                }
              : {
                  ok: true as const,
                  value: [],
                  usage: { promptTokens: 0, completionTokens: 0 },
                  model: "replay:test",
                },
          ),
        synthesize: () =>
          Promise.resolve({
            ok: true as const,
            value: "text",
            usage: { promptTokens: 0, completionTokens: 0 },
            model: "replay:test",
          }),
      },
    });

    // A recording is not a licence to ship. Unmatched is still unmatched.
    expect(outcome.notes.metadata.droppedClaims).toBe(1);
    expect(outcome.notes.objections).toHaveLength(0);
  });
});
