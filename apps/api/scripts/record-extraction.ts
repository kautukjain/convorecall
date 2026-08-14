import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Logger, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { EvidencedSection } from "@opengong/prompts";
import type { ClaimCandidate, TranscriptSegment } from "@opengong/types";
import { AiOrchestratorService } from "../src/modules/ai/ai-orchestrator.service.js";
import { LlmClient } from "../src/modules/ai/llm.client.js";
import { EvidenceService } from "../src/modules/evidence/evidence.service.js";
import { validateEnv } from "../src/config/env.js";

/**
 * Records a real extraction for each sample call into `sample-data/extraction/`, so the
 * demo runs with no key and no network (see `docs/Ship-Blockers.md`, blocker 2).
 *
 * Recording rather than authoring is the point. These claims and quotes are what the model
 * actually returned, so replaying them exercises the real gate. Hand-written recordings
 * would drift into describing a product that grades better than the one we ship.
 *
 * **Stage 1 is recorded raw, before the gate.** That is the difference between a demo and a
 * slideshow: the sample calls that lose a claim live must lose it on replay too, or the
 * offline demo reports `shipped` where the real product reports `partial` — and the drop
 * count is Demo.md's most important beat.
 *
 * **Stage 2 is recorded from survivors only**, because that is what the harness feeds it
 * (ADR-013). Synthesizing from the raw set would let a rejected claim reappear in the
 * summary, which is the leak the two-stage design exists to prevent.
 *
 * Uses the orchestrator directly rather than the HTTP API: pre-gate candidates must never
 * be reachable from a client, since unproven claims in a notes response are precisely what
 * CLAUDE.md forbids. No database and no server are needed — only a model.
 *
 *   pnpm record          # from the repo root
 *
 * Re-record whenever prompts change. Each recording carries the model and date it came from
 * so a stale one is visible rather than silently authoritative.
 */

const ROOT = resolve(import.meta.dirname, "../../..");

const SAMPLE_CALLS = [
  "discovery-call",
  "demo-call",
  "objection-call",
  "support-call",
  "enterprise-call",
] as const;

const EVIDENCED: EvidencedSection[] = ["objections", "intent", "nextSteps"];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: [resolve(ROOT, ".env")],
      validate: validateEnv,
    }),
  ],
  providers: [LlmClient, AiOrchestratorService, EvidenceService],
})
class RecorderModule {}

/**
 * The transcript as extraction will see it: speaker names already applied, ids and offsets
 * present so the gate can resolve a quote. Reading the fixture directly keeps the recorder
 * independent of the database.
 */
function readTranscript(fixture: string): TranscriptSegment[] {
  const path = resolve(ROOT, "sample-data/transcripts", `${fixture}.json`);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    segments: TranscriptSegment[];
    speakerNames?: Array<{ label: string; name: string }>;
  };

  const names = new Map(
    (parsed.speakerNames ?? []).map((entry) => [entry.label, entry.name]),
  );
  return parsed.segments.map((segment, i) => ({
    ...segment,
    index: i,
    speaker: names.get(segment.speaker) ?? segment.speaker,
  }));
}

async function main(): Promise<void> {
  Logger.overrideLogger(["warn", "error"]);
  const app = await NestFactory.createApplicationContext(RecorderModule, {
    logger: ["warn", "error"],
  });
  const ai = app.get(AiOrchestratorService);
  const evidence = app.get(EvidenceService);

  if (!ai.isConfigured()) {
    console.error(
      "No model configured. Set LLM_BASE_URL and LLM_API_KEY in .env — recording is the\n" +
        "one operation that genuinely needs a key.",
    );
    await app.close();
    process.exit(1);
  }

  const dir = resolve(ROOT, "sample-data/extraction");
  mkdirSync(dir, { recursive: true });
  let failures = 0;

  for (const fixture of SAMPLE_CALLS) {
    try {
      const segments = readTranscript(fixture);
      const raw: Record<EvidencedSection, ClaimCandidate[]> = {
        objections: [],
        intent: [],
        nextSteps: [],
      };

      let model = "unknown";
      for (const section of EVIDENCED) {
        const result = await ai.extractClaims(section, segments);
        if (!result.ok) throw new Error(`${section}: ${result.reason}`);
        model = result.model;
        raw[section] = result.value;
      }

      const survivors = EVIDENCED.flatMap((section) =>
        evidence
          .gate(raw[section], segments)
          .kept.map((kept) => ({ section, claim: kept.claim, quote: kept.quote })),
      );

      const derived: Record<string, string> = {};
      for (const section of ["summary", "followUpEmail"] as const) {
        const result = await ai.synthesize(section, survivors);
        if (!result.ok) throw new Error(`${section}: ${result.reason}`);
        model = result.model;
        derived[section] = result.value;
      }

      const recording = {
        callId: fixture,
        recordedFrom: { model, at: new Date().toISOString() },
        sections: {
          objections: raw.objections,
          intent: raw.intent,
          nextSteps: raw.nextSteps,
          summary: derived.summary ?? "",
          followUpEmail: derived.followUpEmail ?? "",
        },
      };
      writeFileSync(
        resolve(dir, `${fixture}.json`),
        `${JSON.stringify(recording, null, 2)}\n`,
      );

      const rawTotal = EVIDENCED.reduce((sum, s) => sum + raw[s].length, 0);
      const willDrop = rawTotal - survivors.length;
      console.log(
        `${fixture.padEnd(16)} ${rawTotal} raw claim(s), ${survivors.length} survive` +
          `${willDrop > 0 ? `, ${willDrop} dropped by the gate` : ""}`,
      );
    } catch (error) {
      failures += 1;
      console.error(
        `${fixture.padEnd(16)} FAILED  ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  await app.close();
  console.log(
    failures === 0
      ? `\nRecorded ${SAMPLE_CALLS.length} extractions to sample-data/extraction/.`
      : `\n${SAMPLE_CALLS.length - failures} recorded, ${failures} failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
