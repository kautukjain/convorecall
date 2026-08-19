import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import { TranscriptSchema } from "@convorecall/validators";
import { ProblemException } from "../../../common/problem.js";
import type { SttResult } from "../stt.types.js";

/**
 * Reads a hand-authored transcript from `sample-data/transcripts` (ADR-012).
 *
 * This is a first-class ingest path, not a test double: it is the default in evals, the
 * rehearsed demo fallback, and — while no STT provider is reachable — the only path that
 * produces a transcript at all.
 */
@Injectable()
export class FixtureSttProvider {
  readonly id = "fixture";
  private readonly logger = new Logger(FixtureSttProvider.name);
  private readonly root = resolve(process.cwd(), "../../sample-data/transcripts");

  async load(fixtureName: string): Promise<SttResult> {
    if (!/^[a-z0-9-]{1,64}$/.test(fixtureName)) {
      throw new ProblemException("invalid_request", "Malformed fixture name.");
    }

    const path = resolve(this.root, `${fixtureName}.json`);
    if (!path.startsWith(this.root)) {
      throw new ProblemException("invalid_request", "Malformed fixture name.");
    }

    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      throw new ProblemException(
        "invalid_request",
        `Fixture "${fixtureName}" could not be read.`,
        error instanceof Error ? error.message : String(error),
      );
    }

    const parsed = TranscriptSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ProblemException(
        "invalid_request",
        `Fixture "${fixtureName}" does not match the transcript schema.`,
        parsed.error.issues.map((i) => i.message).join("; "),
      );
    }

    const segments = parsed.data.segments.map((segment) => ({
      speaker: segment.speaker,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
    }));

    this.logger.log(`Loaded fixture ${fixtureName} (${segments.length} segments)`);

    return {
      segments,
      durationMs:
        parsed.data.durationMs ??
        segments.reduce((max, s) => Math.max(max, s.endMs), 0),
      // Null model is meaningful: it records that no STT ran (docs/Harness.md).
      model: null,
      // Passed on unverified. The gate decides which of these survive.
      speakerNames: parsed.data.speakerNames ?? [],
    };
  }
}
