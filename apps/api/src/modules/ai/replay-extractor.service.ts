import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import type { DerivedSection, EvidencedSection } from "@convorecall/prompts";
import { RecordedExtractionSchema } from "@convorecall/validators";
import type { SectionOutcome } from "./ai-orchestrator.service.js";
import type { ExtractionSource } from "./extraction-source.js";

/** Replay spends nothing. Recorded token counts belong to the run that was recorded. */
const NO_USAGE = { promptTokens: 0, completionTokens: 0 } as const;

/**
 * Replays a recorded extraction for a sample call, so the demo runs with no key and no
 * network (ADR-012 extends fixture mode from speech to extraction).
 *
 * The recordings are real model output captured by `scripts/record-extraction.ts`, not
 * hand-written answers. That distinction matters twice: the quotes are verbatim, so they
 * survive the evidence gate the same way they did live; and nobody is tempted to author a
 * flattering result that the product could not actually produce.
 *
 * Deliberately *not* a fallback for uploaded audio. A real call has no recording, and
 * quietly serving one call's notes for another call's audio is the worst failure this
 * codebase could ship. Absent a recording, the job still fails with `llm_not_configured`.
 *
 * `sample-data/expected-output/` is not used here. Those files are generated scaffolding —
 * five copies of the same placeholder quote, which no transcript contains — so replaying
 * them would produce an empty demo and blame the gate for it (see `PROJECT_STATE.md`).
 */
@Injectable()
export class ReplayExtractorService {
  private readonly logger = new Logger(ReplayExtractorService.name);
  private readonly root = resolve(process.cwd(), "../../sample-data/extraction");

  /**
   * Returns a source bound to one recording, or null when there is none.
   *
   * Bound per call rather than held as service state: the worker runs
   * `WORKER_CONCURRENCY` jobs at once, and a shared "current fixture" field would let two
   * calls hand each other their notes.
   */
  async load(fixtureName: string): Promise<ExtractionSource | null> {
    if (!/^[a-z0-9-]{1,64}$/.test(fixtureName)) return null;

    const path = resolve(this.root, `${fixtureName}.json`);
    if (!path.startsWith(this.root)) return null;

    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path, "utf8"));
    } catch {
      // No recording is an ordinary state, not an error: only sample calls have one.
      return null;
    }

    const parsed = RecordedExtractionSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(
        `Recording for "${fixtureName}" does not match the schema: ${parsed.error.issues
          .map((issue) => issue.message)
          .join("; ")}`,
      );
      return null;
    }

    const { sections } = parsed.data;
    // Names the replay in `notes.metadata.llmModel`, so an export can never imply that a
    // live model produced these notes.
    const model = `replay:${fixtureName}`;
    this.logger.log(
      `Replaying recorded extraction for ${fixtureName} (recorded from ${parsed.data.recordedFrom.model})`,
    );

    return {
      extractClaims: (section: EvidencedSection) => {
        const claims = sections[section];
        // A recorded empty section is a real result — the call genuinely had no objections
        // — so it is returned as an empty list and lets the gate drop the section, rather
        // than reported as a missing recording.
        return Promise.resolve(
          { ok: true, value: claims, usage: NO_USAGE, model } as SectionOutcome<
            typeof claims
          >,
        );
      },

      synthesize: (section: DerivedSection) => {
        const text = sections[section];
        if (!text) {
          return Promise.resolve({
            ok: false,
            reason: "not_recorded",
            usage: NO_USAGE,
          } as SectionOutcome<string>);
        }
        return Promise.resolve({
          ok: true,
          value: text,
          usage: NO_USAGE,
          model,
        } as SectionOutcome<string>);
      },
    };
  }
}
