import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Logger, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { TranscriptSegment } from "@convorecall/types";
import { AiOrchestratorService } from "../src/modules/ai/ai-orchestrator.service.js";
import type { ExtractionSource } from "../src/modules/ai/extraction-source.js";
import { LlmClient } from "../src/modules/ai/llm.client.js";
import {
  CompositeExtractionSource,
  RecapExtractionSource,
} from "../src/modules/ai/recap-extraction.source.js";
import { RecapClient } from "../src/modules/ai/recap.client.js";
import { validateEnv } from "../src/config/env.js";
import { EvidenceService } from "../src/modules/evidence/evidence.service.js";
import { NotesService } from "../src/modules/notes/notes.service.js";

/**
 * Measures the extraction sources against each other on the five sample calls.
 *
 * The point is to make the trade visible before it becomes a default: how many claims each source
 * produces, how many survive the evidence gate, what a claim reads like, and what it costs. A table
 * beats an argument.
 *
 *   pnpm compare
 *
 * Recap is metered per call and the current key caps at 10 units a day, so `RecapClient` caches every
 * response under `.data/recap-cache/`. A second run costs nothing.
 */

const ROOT = resolve(import.meta.dirname, "../../..");
const CALLS = [
  "discovery-call",
  "demo-call",
  "objection-call",
  "support-call",
  "enterprise-call",
] as const;

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: [resolve(ROOT, ".env")],
      validate: validateEnv,
    }),
  ],
  providers: [LlmClient, AiOrchestratorService, RecapClient, EvidenceService, NotesService],
})
class CompareModule {}

/** The transcript as extraction sees it: speaker names applied, ids and offsets present. */
function transcript(call: string): TranscriptSegment[] {
  const parsed = JSON.parse(
    readFileSync(resolve(ROOT, `sample-data/transcripts/${call}.json`), "utf8"),
  ) as { segments: TranscriptSegment[]; speakerNames?: Array<{ label: string; name: string }> };
  const names = new Map((parsed.speakerNames ?? []).map((entry) => [entry.label, entry.name]));
  return parsed.segments.map((segment, index) => ({
    ...segment,
    index,
    speaker: names.get(segment.speaker) ?? segment.speaker,
  }));
}

type Row = {
  call: string;
  mode: string;
  exit: string;
  kept: number;
  dropped: number;
  sections: string;
  tokens: number;
  sample: string;
};

async function run(
  notes: NotesService,
  call: string,
  mode: string,
  segments: TranscriptSegment[],
  source: ExtractionSource | undefined,
): Promise<Row> {
  const outcome = await notes.extract({
    callId: `compare-${call}`,
    segments,
    sttModel: null,
    tokenBudget: 200_000,
    deadlineAt: new Date(Date.now() + 300_000),
    startedAt: Date.now(),
    source,
  });

  const evidenced = [
    ...(outcome.notes.intent ? [outcome.notes.intent] : []),
    ...outcome.notes.objections,
    ...outcome.notes.nextSteps,
  ].filter((entry) => entry.claim);

  return {
    call,
    mode,
    exit: outcome.exitStatus,
    kept: evidenced.length,
    dropped: outcome.notes.metadata.droppedClaims,
    sections: `obj ${outcome.notes.objections.length}/int ${
      outcome.notes.intent?.claim ? 1 : 0
    }/next ${outcome.notes.nextSteps.length}`,
    tokens: outcome.notes.metadata.tokensUsed,
    sample: evidenced[0]?.claim.slice(0, 58) ?? "—",
  };
}

async function main(): Promise<void> {
  Logger.overrideLogger(["error"]);
  const app = await NestFactory.createApplicationContext(CompareModule, { logger: ["error"] });
  const notes = app.get(NotesService);
  const recap = app.get(RecapClient);
  const orchestrator = app.get(AiOrchestratorService);

  const rows: Row[] = [];

  for (const call of CALLS) {
    const segments = transcript(call);
    const utterances = RecapClient.toUtterances(segments);
    const record = await recap.analyse(`convorecall-${call}`, utterances).catch(() => null);

    if (record) {
      // The fixtures label our side `Rep`, so this is true for them — measuring with it hardcoded
      // would hide the upload case, which is the one that fails.
      const recapSource = new RecapExtractionSource(
        record,
        RecapClient.rolesResolved(utterances),
      );
      rows.push(await run(notes, call, "pyai-only", segments, recapSource));
      if (orchestrator.isConfigured()) {
        rows.push(
          await run(
            notes,
            call,
            "pyai+llm",
            segments,
            new CompositeExtractionSource(recapSource, orchestrator),
          ),
        );
      }
    } else {
      console.error(`  ${call}: no Recap record (capped, disabled, or failed)`);
    }

    if (orchestrator.isConfigured()) {
      rows.push(await run(notes, call, "llm-only", segments, undefined));
    }
    process.stdout.write(`\r  measured ${call}                    `);
  }
  process.stdout.write("\n\n");

  console.log(
    `  ${"call".padEnd(16)}${"mode".padEnd(11)}${"exit".padEnd(9)}${"kept".padEnd(6)}${"dropped".padEnd(9)}${"sections".padEnd(22)}tokens`,
  );
  for (const r of rows) {
    console.log(
      `  ${r.call.padEnd(16)}${r.mode.padEnd(11)}${r.exit.padEnd(9)}${String(r.kept).padEnd(6)}${String(r.dropped).padEnd(9)}${r.sections.padEnd(22)}${r.tokens}`,
    );
  }

  for (const mode of ["pyai-only", "pyai+llm", "llm-only"]) {
    const group = rows.filter((row) => row.mode === mode);
    if (group.length === 0) continue;
    const kept = group.reduce((sum, row) => sum + row.kept, 0);
    const dropped = group.reduce((sum, row) => sum + row.dropped, 0);
    const tokens = Math.round(group.reduce((sum, row) => sum + row.tokens, 0) / group.length);
    console.log(
      `\n  ${mode}: ${kept} claims, ${dropped} dropped, ~${tokens} tokens/call` +
        `\n    e.g. ${JSON.stringify(group.find((row) => row.sample !== "—")?.sample ?? "—")}`,
    );
  }

  await app.close();
  process.exit(0);
}

void main();
