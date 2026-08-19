import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  DERIVED_PROMPTS,
  EVIDENCED_PROMPTS,
  REPAIR_PROMPT,
  SPEAKER_NAMING_PROMPT,
  buildDerivedUserPrompt,
  buildEvidencedUserPrompt,
  buildRepairUserPrompt,
  buildSpeakerNamingPrompt,
  renderTranscript,
  type DerivedSection,
  type EvidencedSection,
} from "@convorecall/prompts";
import { ExtractedClaimsSchema, SpeakerNamesSchema } from "@convorecall/validators";
import type { ClaimCandidate } from "@convorecall/types";
import { z } from "zod";
import { LlmClient, type ChatMessage } from "./llm.client.js";

const DerivedTextSchema = z.object({ text: z.string() });

export type TokenUsage = { promptTokens: number; completionTokens: number };

export type SectionOutcome<T> =
  | { ok: true; value: T; usage: TokenUsage; model: string }
  | { ok: false; reason: string; usage: TokenUsage };

/**
 * Every model call goes through here (.cursor/rules/ai.mdc).
 *
 * Owns the **schema gate** and its single repair attempt. Transport retry belongs to the
 * client — two mechanisms, two budgets, never nested (ADR-007).
 */
@Injectable()
export class AiOrchestratorService {
  private readonly logger = new Logger(AiOrchestratorService.name);

  constructor(
    private readonly llm: LlmClient,
    private readonly config: ConfigService,
  ) {}

  isConfigured(): boolean {
    return this.llm.isConfigured();
  }

  async extractClaims(
    section: EvidencedSection,
    segments: Array<{ speaker: string; text: string }>,
  ): Promise<SectionOutcome<ClaimCandidate[]>> {
    const prompt = EVIDENCED_PROMPTS[section];
    const messages: ChatMessage[] = [
      { role: "system", content: prompt.system },
      {
        role: "user",
        content: buildEvidencedUserPrompt(renderTranscript(segments)),
      },
    ];

    return this.callWithSchemaGate(
      section,
      messages,
      ExtractedClaimsSchema,
      '{"claims":[{"claim":"string","quote":"string","confidence":0-1}]}',
      (parsed) => parsed.claims,
      0.2,
    );
  }

  /** Names diarized speakers. Verified by the caller, not trusted here. */
  async nameSpeakers(
    segments: Array<{ speaker: string; text: string }>,
  ): Promise<SectionOutcome<Array<{ label: string; name: string; quote: string }>>> {
    return this.callWithSchemaGate(
      "speakers",
      [
        { role: "system", content: SPEAKER_NAMING_PROMPT.system },
        {
          role: "user",
          content: buildSpeakerNamingPrompt(renderTranscript(segments)),
        },
      ],
      SpeakerNamesSchema,
      '{"speakers":[{"label":"Speaker 1","name":"string","quote":"string"}]}',
      (parsed) => parsed.speakers,
      0,
    );
  }

  async synthesize(
    section: DerivedSection,
    claims: Array<{ section: string; claim: string; quote: string }>,
  ): Promise<SectionOutcome<string>> {
    const prompt = DERIVED_PROMPTS[section];
    const messages: ChatMessage[] = [
      { role: "system", content: prompt.system },
      // Claims only. The transcript is deliberately absent (ADR-013).
      { role: "user", content: buildDerivedUserPrompt(claims) },
    ];

    // Email wording tolerates a little warmth; extraction never does.
    const temperature = section === "followUpEmail" ? 0.4 : 0.2;

    return this.callWithSchemaGate(
      section,
      messages,
      DerivedTextSchema,
      '{"text":"string"}',
      (parsed) => parsed.text,
      temperature,
    );
  }

  private async callWithSchemaGate<TParsed, TValue>(
    label: string,
    messages: ChatMessage[],
    schema: z.ZodType<TParsed>,
    schemaHint: string,
    select: (parsed: TParsed) => TValue,
    temperature: number,
  ): Promise<SectionOutcome<TValue>> {
    const usage: TokenUsage = { promptTokens: 0, completionTokens: 0 };
    const repairBudget = this.config.get<number>("SCHEMA_REPAIR_MAX") ?? 1;

    const first = await this.llm.chat(messages, temperature);
    usage.promptTokens += first.promptTokens;
    usage.completionTokens += first.completionTokens;

    const parsed = this.parse(schema, first.content);
    if (parsed.ok) {
      return { ok: true, value: select(parsed.value), usage, model: first.model };
    }

    if (repairBudget < 1) {
      return { ok: false, reason: `schema_invalid: ${parsed.errors}`, usage };
    }

    this.logger.warn(`${label}: schema gate rejected output, repairing once`);

    const repaired = await this.llm.chat(
      [
        { role: "system", content: REPAIR_PROMPT.system },
        {
          role: "user",
          content: buildRepairUserPrompt(
            first.content.slice(0, 8_000),
            schemaHint,
            parsed.errors,
          ),
        },
      ],
      0,
    );
    usage.promptTokens += repaired.promptTokens;
    usage.completionTokens += repaired.completionTokens;

    const second = this.parse(schema, repaired.content);
    if (second.ok) {
      return {
        ok: true,
        value: select(second.value),
        usage,
        model: repaired.model,
      };
    }

    // A repaired response that still fails is discarded whole — never partially
    // salvaged (docs/Harness.md).
    return { ok: false, reason: `schema_invalid_after_repair`, usage };
  }

  private parse<T>(
    schema: z.ZodType<T>,
    raw: string,
  ): { ok: true; value: T } | { ok: false; errors: string } {
    let json: unknown;
    try {
      json = JSON.parse(this.stripFences(raw));
    } catch (error) {
      return {
        ok: false,
        errors: `not valid JSON: ${error instanceof Error ? error.message : "parse error"}`,
      };
    }

    const result = schema.safeParse(json);
    if (!result.success) {
      return {
        ok: false,
        errors: result.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; "),
      };
    }
    return { ok: true, value: result.data };
  }

  /** Models add code fences despite being told not to. Cheap to tolerate. */
  private stripFences(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("```")) return trimmed;
    return trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```$/, "")
      .trim();
  }
}
