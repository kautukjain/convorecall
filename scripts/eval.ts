import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  buildTranscriptIndex,
  resolveQuote,
  HARNESS_DEFAULTS,
} from "@opengong/shared";
import type { TranscriptSegment } from "@opengong/types";

/**
 * Eval runner (ADR-015, docs/Evals.md).
 *
 * Scores the **evidence gate** against hand-authored golden files: every positive case
 * must resolve to its recorded segment, and every negative case — a plausible statement
 * that was never made — must be rejected.
 *
 * This is the half of the eval that does not need a model. Claim recall additionally
 * requires running extraction, and is reported as `n/a` until `LLM_BASE_URL` and
 * `LLM_API_KEY` are set.
 */

const ROOT = resolve(import.meta.dirname, "..");
const THRESHOLD = Number(
  process.env.EVIDENCE_MATCH_THRESHOLD ?? HARNESS_DEFAULTS.EVIDENCE_MATCH_THRESHOLD,
);

type GoldenPositive = {
  id: string;
  claim: string;
  quote: string;
  segmentId: string;
  speaker?: string;
  required?: boolean;
};
type GoldenNegative = { id: string; claim: string; why?: string };
type Golden = {
  callName: string;
  transcript: string;
  section: string;
  positive: GoldenPositive[];
  negative: GoldenNegative[];
};

type Report = {
  file: string;
  section: string;
  spanAccuracy: number;
  hallucinationRate: number;
  positives: { total: number; resolved: number; correctSpan: number };
  negatives: { total: number; rejected: number; leaked: GoldenNegative[] };
};

function findGoldenFiles(sectionFilter?: string): string[] {
  const evalsDir = resolve(ROOT, "evals");
  const files: string[] = [];
  for (const entry of readdirSync(evalsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (sectionFilter && entry.name !== sectionFilter) continue;
    const dir = join(evalsDir, entry.name);
    for (const file of readdirSync(dir)) {
      if (file.endsWith(".golden.json")) files.push(join(dir, file));
    }
  }
  return files.sort();
}

function evaluate(path: string): Report {
  const golden = JSON.parse(readFileSync(path, "utf8")) as Golden;
  const transcriptPath = resolve(ROOT, golden.transcript);
  if (!existsSync(transcriptPath)) {
    throw new Error(`Missing transcript ${golden.transcript} for ${path}`);
  }

  const transcript = JSON.parse(readFileSync(transcriptPath, "utf8")) as {
    segments: TranscriptSegment[];
  };
  const index = buildTranscriptIndex(transcript.segments);

  let resolved = 0;
  let correctSpan = 0;
  for (const positive of golden.positive) {
    const match = resolveQuote(index, positive.quote, THRESHOLD);
    if (!match) continue;
    resolved += 1;
    if (match.segmentIds.includes(positive.segmentId)) correctSpan += 1;
  }

  // A hallucinating extractor offers its own claim text as the supporting quote.
  // Nothing in this set was said, so nothing may resolve.
  const leaked: GoldenNegative[] = [];
  for (const negative of golden.negative) {
    if (resolveQuote(index, negative.claim, THRESHOLD)) leaked.push(negative);
  }

  return {
    file: path.replace(`${ROOT}/`, ""),
    section: golden.section,
    spanAccuracy: resolved === 0 ? 0 : correctSpan / resolved,
    hallucinationRate:
      golden.negative.length === 0 ? 0 : leaked.length / golden.negative.length,
    positives: {
      total: golden.positive.length,
      resolved,
      correctSpan,
    },
    negatives: {
      total: golden.negative.length,
      rejected: golden.negative.length - leaked.length,
      leaked,
    },
  };
}

type LiveReport = {
  callName: string;
  exitStatus: string;
  shipped: number;
  unresolved: number;
  recallFound: number;
  recallTotal: number;
  requiredFound: number;
  requiredTotal: number;
  missed: string[];
};

/**
 * Live mode runs the deployed pipeline and scores what it actually shipped.
 *
 * Hallucination rate is structural here: the gate cannot ship a claim whose quote does
 * not resolve. `unresolved` asserts that invariant rather than assuming it. Recall is
 * the number that genuinely varies, and it is tracked, never gated (ADR-015).
 */
async function evaluateLive(
  apiUrl: string,
  golden: Golden,
): Promise<LiveReport> {
  const created = await fetch(`${apiUrl}/calls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fixture: golden.callName }),
  });
  if (!created.ok) {
    throw new Error(`POST /calls returned ${created.status}`);
  }
  const { id } = (await created.json()) as { id: string };

  const terminal = ["shipped", "partial", "failed", "deadline"];
  let state = "queued";
  for (let i = 0; i < 60 && !terminal.includes(state); i += 1) {
    await new Promise((done) => setTimeout(done, 2_000));
    const status = await fetch(`${apiUrl}/calls/${id}`);
    state = ((await status.json()) as { state: string }).state;
  }

  const notesResponse = await fetch(`${apiUrl}/calls/${id}/notes`);
  if (!notesResponse.ok) {
    return {
      callName: golden.callName,
      exitStatus: state,
      shipped: 0,
      unresolved: 0,
      recallFound: 0,
      recallTotal: golden.positive.length,
      requiredFound: 0,
      requiredTotal: golden.positive.filter((p) => p.required !== false).length,
      missed: golden.positive.map((p) => p.id),
    };
  }

  const notes = (await notesResponse.json()) as {
    objections: Array<{ quote: string; segmentIds: string[] }>;
    intent: { quote: string; segmentIds: string[] };
    nextSteps: Array<{ quote: string; segmentIds: string[] }>;
  };

  const transcript = JSON.parse(
    readFileSync(resolve(ROOT, golden.transcript), "utf8"),
  ) as { segments: TranscriptSegment[] };
  const index = buildTranscriptIndex(transcript.segments);

  const shippedClaims = [
    ...notes.objections,
    ...notes.nextSteps,
    ...(notes.intent.quote ? [notes.intent] : []),
  ];

  const unresolved = shippedClaims.filter(
    (claim) => !resolveQuote(index, claim.quote, THRESHOLD),
  ).length;

  // Golden ids are the fixture's own segment ids; the API returns database ids. Compare
  // by resolving each shipped quote back to a fixture segment.
  const coveredSegments = new Set<string>();
  for (const claim of shippedClaims) {
    const match = resolveQuote(index, claim.quote, THRESHOLD);
    for (const segmentId of match?.segmentIds ?? []) coveredSegments.add(segmentId);
  }

  const missedCases = golden.positive.filter(
    (positive) => !coveredSegments.has(positive.segmentId),
  );
  // `required: false` marks a case a competent extractor may reasonably miss. Folding
  // those into one percentage makes a good run look worse than it is.
  const required = golden.positive.filter((p) => p.required !== false);
  const missedRequired = missedCases.filter((p) => p.required !== false);

  return {
    callName: golden.callName,
    exitStatus: state,
    shipped: shippedClaims.length,
    unresolved,
    recallFound: golden.positive.length - missedCases.length,
    recallTotal: golden.positive.length,
    requiredFound: required.length - missedRequired.length,
    requiredTotal: required.length,
    missed: missedCases.map(
      (p) => `${p.id}${p.required === false ? " (optional)" : " (REQUIRED)"}`,
    ),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sectionIndex = args.indexOf("--section");
  const section = sectionIndex >= 0 ? args[sectionIndex + 1] : undefined;
  const live = args.includes("--live");

  const files = findGoldenFiles(section);
  if (files.length === 0) {
    console.error(
      section
        ? `No golden files under evals/${section}/`
        : "No golden files found under evals/",
    );
    process.exit(1);
  }

  const llmConfigured = Boolean(process.env.LLM_BASE_URL && process.env.LLM_API_KEY);

  console.log(`Evidence gate eval — threshold ${THRESHOLD}\n`);

  const reports = files.map(evaluate);
  let failed = false;

  for (const report of reports) {
    const gateOk = report.hallucinationRate === 0 && report.spanAccuracy >= 0.98;
    if (!gateOk) failed = true;

    console.log(`${report.file}  [${report.section}]`);
    console.log(
      `  positives      ${report.positives.correctSpan}/${report.positives.total} resolved to the correct segment`,
    );
    console.log(
      `  negatives      ${report.negatives.rejected}/${report.negatives.total} correctly rejected`,
    );
    console.log(
      `  span accuracy  ${(report.spanAccuracy * 100).toFixed(1)}%   (gate: >= 98%)`,
    );
    console.log(
      `  hallucination  ${(report.hallucinationRate * 100).toFixed(1)}%   (gate: 0%)`,
    );
    for (const leak of report.negatives.leaked) {
      console.log(`  LEAKED  ${leak.id}: ${leak.claim}`);
    }
    console.log(`  ${gateOk ? "PASS" : "FAIL"}\n`);
  }

  if (!live) {
    console.log(
      `claim recall     n/a — pass --live to run extraction and measure it.${
        llmConfigured ? "" : " Requires LLM_BASE_URL and LLM_API_KEY."
      }`,
    );
  } else {
    const apiUrl = process.env.EVAL_API_URL ?? "http://localhost:3001/api/v1";
    console.log(`Live extraction eval — ${apiUrl}\n`);

    for (const path of files) {
      const golden = JSON.parse(readFileSync(path, "utf8")) as Golden;
      const report = await evaluateLive(apiUrl, golden);

      console.log(`${golden.callName}  [${report.exitStatus}]`);
      console.log(`  claims shipped   ${report.shipped}`);
      console.log(
        `  unresolved       ${report.unresolved}   (invariant: must be 0)`,
      );
      console.log(
        `  recall (required) ${report.requiredFound}/${report.requiredTotal}` +
          ` (${((report.requiredFound / report.requiredTotal) * 100).toFixed(0)}%) — tracked, not gated`,
      );
      console.log(
        `  recall (all)      ${report.recallFound}/${report.recallTotal}`,
      );
      for (const id of report.missed) console.log(`  missed  ${id}`);

      // Hallucination is the gate; recall is a signal. Only the former can fail a run.
      if (report.unresolved > 0) {
        failed = true;
        console.log("  FAIL — a shipped claim does not resolve\n");
      } else {
        console.log("  PASS\n");
      }
    }
  }

  if (failed) {
    console.error("\nEval FAILED. Never respond by lowering a gate (docs/Evals.md).");
    process.exit(1);
  }
  console.log("\nEval PASSED.");
}

void main();
