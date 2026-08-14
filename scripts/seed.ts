import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

const SAMPLE_CALLS = [
  "discovery-call",
  "demo-call",
  "objection-call",
  "support-call",
  "enterprise-call",
] as const;

function main(): void {
  const transcriptsDir = resolve(ROOT, "sample-data/transcripts");
  const expectedDir = resolve(ROOT, "sample-data/expected-output");
  mkdirSync(transcriptsDir, { recursive: true });
  mkdirSync(expectedDir, { recursive: true });

  for (const name of SAMPLE_CALLS) {
    const transcriptPath = resolve(transcriptsDir, `${name}.json`);
    const expectedPath = resolve(expectedDir, `${name}.json`);

    if (!existsSync(transcriptPath)) {
      writeFileSync(
        transcriptPath,
        JSON.stringify(
          {
            callId: name,
            speakers: ["Rep", "Prospect"],
            segments: [
              {
                id: "seg-1",
                speaker: "Rep",
                startMs: 0,
                endMs: 4000,
                text: "Thanks for taking the time today.",
              },
              {
                id: "seg-2",
                speaker: "Prospect",
                startMs: 4000,
                endMs: 9000,
                text: "We are evaluating options and worried about price.",
              },
            ],
          },
          null,
          2,
        ),
      );
    }

    if (!existsSync(expectedPath)) {
      writeFileSync(
        expectedPath,
        JSON.stringify(
          {
            callId: name,
            exitStatus: "shipped",
            summary: "Introductory conversation covering evaluation and pricing concerns.",
            objections: [
              {
                claim: "Prospect raised pricing concern",
                quote: "worried about price",
                segmentIds: ["seg-2"],
              },
            ],
            intent: "Evaluating vendors",
            nextSteps: ["Send pricing one-pager", "Schedule technical deep-dive"],
            followUpEmail:
              "Hi — thanks for the conversation. Sharing a one-pager on pricing and proposing times for a technical deep-dive.",
          },
          null,
          2,
        ),
      );
    }
  }

  console.log(`Seeded ${SAMPLE_CALLS.length} transcript + expected-output fixtures.`);
}

main();
