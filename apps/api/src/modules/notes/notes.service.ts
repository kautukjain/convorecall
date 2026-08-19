import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PROMPT_VERSION, type EvidencedSection } from "@convorecall/prompts";
import type {
  CallNotes,
  Evidence,
  JobExitStatus,
  TranscriptSegment,
  UncitedNotes,
} from "@convorecall/types";
import { AiOrchestratorService } from "../ai/ai-orchestrator.service.js";
import type { ExtractionSource } from "../ai/extraction-source.js";
import { EvidenceService } from "../evidence/evidence.service.js";
import { resolveExitStatus } from "./exit-status.js";
import { composeEmail } from "./recipient.js";

const EVIDENCED: EvidencedSection[] = ["objections", "intent", "nextSteps"];

/**
 * Drops uncited next steps that a cited answer has already covered.
 *
 * In composite mode both sources answer this section: Recap returns action items with no quote, and
 * the model returns next steps with one. Forwarding both put the same commitments on the page twice —
 * once with a timestamp, once without — which reads as two different lists and quietly devalues the
 * cited one. When the gate kept a next step, the uncited copy adds nothing and is dropped.
 *
 * Key decisions survive regardless: they have no evidenced counterpart, so nothing else would show
 * them, and this function exists to remove duplicates rather than to hide vendor output.
 */
function withoutRedundantItems(
  uncited: UncitedNotes | null,
  citedNextSteps: Evidence[],
): UncitedNotes | undefined {
  if (!uncited) return undefined;
  if (citedNextSteps.length === 0) return uncited;

  const kept: UncitedNotes = {
    source: uncited.source,
    actionItems: [],
    ...(uncited.keyDecisions?.length ? { keyDecisions: uncited.keyDecisions } : {}),
  };
  // Nothing left worth labelling means nothing to attach.
  return kept.keyDecisions?.length ? kept : undefined;
}

export type ExtractionOutcome = {
  notes: CallNotes;
  exitStatus: JobExitStatus;
  tokensUsed: number;
  llmModel: string;
};

export type ExtractionInput = {
  callId: string;
  segments: TranscriptSegment[];
  sttModel: string | null;
  tokenBudget: number;
  deadlineAt: Date;
  startedAt: number;
  /**
   * Where raw sections come from. Defaults to the live orchestrator; the worker supplies a
   * replay source for a sample call when no model is configured. The harness below does not
   * branch on which it got — that is the point.
   */
  source?: ExtractionSource;
};

/**
 * The extraction harness (docs/Harness.md).
 *
 * Two stages, deliberately: evidenced sections are extracted and gated first, then the
 * derived sections are synthesized from what survived. Gating between them is what makes
 * a dropped claim unable to reappear in the summary or the email (ADR-013).
 */
@Injectable()
export class NotesService {
  private readonly logger = new Logger(NotesService.name);

  constructor(
    private readonly ai: AiOrchestratorService,
    private readonly evidence: EvidenceService,
    private readonly config: ConfigService,
  ) {}

  async extract(input: ExtractionInput): Promise<ExtractionOutcome> {
    // Live orchestrator unless the caller supplied a replay for a sample call.
    const ai: ExtractionSource = input.source ?? this.ai;
    const droppedSections: string[] = [];
    let droppedClaims = 0;
    let tokensUsed = 0;
    let llmModel = this.config.get<string>("LLM_MODEL") ?? "unknown";
    let budgetExhausted = false;

    const spend = (usage: { promptTokens: number; completionTokens: number }) => {
      tokensUsed += usage.promptTokens + usage.completionTokens;
    };

    const overBudget = (): boolean =>
      tokensUsed >= input.tokenBudget || Date.now() >= input.deadlineAt.getTime();

    // ---- Stage 1: evidenced sections ------------------------------------------------
    const gated: Record<EvidencedSection, Evidence[]> = {
      objections: [],
      intent: [],
      nextSteps: [],
    };

    for (const section of EVIDENCED) {
      // The governor checks before spending, not after (docs/Harness.md).
      if (overBudget()) {
        budgetExhausted = true;
        droppedSections.push(section);
        continue;
      }

      const result = await ai.extractClaims(section, input.segments);
      spend(result.usage);

      if (!result.ok) {
        this.logger.warn(`Section ${section} dropped: ${result.reason}`);
        droppedSections.push(section);
        continue;
      }
      llmModel = result.model;

      const { kept, dropped } = this.evidence.gate(result.value, input.segments);
      droppedClaims += dropped;

      if (kept.length === 0) {
        // An evidenced section with nothing left is a dropped section.
        droppedSections.push(section);
        continue;
      }
      gated[section] = kept;
    }

    // ---- Stage 2: derived sections, from survivors only ----------------------------
    const survivors = EVIDENCED.flatMap((section) =>
      gated[section].map((evidence) => ({
        section,
        claim: evidence.claim,
        quote: evidence.quote,
      })),
    );

    let summary = "";
    let followUpEmail = "";

    if (survivors.length === 0) {
      // Nothing survived, so there is nothing honest to synthesize from.
      droppedSections.push("summary", "followUpEmail");
    } else {
      for (const section of ["summary", "followUpEmail"] as const) {
        if (overBudget()) {
          budgetExhausted = true;
          droppedSections.push(section);
          continue;
        }
        const result = await ai.synthesize(section, survivors);
        spend(result.usage);
        if (!result.ok) {
          this.logger.warn(`Section ${section} dropped: ${result.reason}`);
          droppedSections.push(section);
          continue;
        }
        llmModel = result.model;
        if (section === "summary") summary = result.value;
        else followUpEmail = result.value;
      }
    }

    // Whatever the source produced without a quote to place it by. Read after extraction so a source
    // can build it from the same response it answered the sections from.
    const uncited = withoutRedundantItems(ai.uncited?.() ?? null, gated.nextSteps);

    if (overBudget()) budgetExhausted = true;

    const exitStatus = resolveExitStatus({
      droppedSections,
      droppedClaims,
      budgetExhausted,
    });

    /*
     * A missing intent is `null`, not a blank Evidence.
     *
     * The blank stood in for absence for a long time and only failed once intent could actually drop
     * (Recap's buying signals are withheld when speaker roles are unknown). It was an `Evidence` with
     * an empty claim, empty quote, empty speaker and no segment ids — every invariant of the type it
     * claimed to be — so `CallNotesSchema` rejected the whole payload and the call became unservable.
     * A sentinel that satisfies the compiler and not the contract is worse than an honest null.
     */
    const intent: Evidence | null = gated.intent[0] ?? null;

    const notes: CallNotes = {
      callId: input.callId,
      exitStatus,
      summary,
      intent,
      objections: gated.objections,
      nextSteps: gated.nextSteps,
      // Separately labelled, never counted among the evidenced claims (ADR-002).
      ...(uncited ? { uncited } : {}),
      // The model writes the body and is forbidden from writing names at all. The greeting
      // is added here from the speaker the gate resolved, and omitted when there is no single
      // provable recipient — never filled with a placeholder.
      followUpEmail: composeEmail(followUpEmail, intent, gated.objections),
      metadata: {
        exitStatus,
        droppedClaims,
        droppedSections,
        promptVersion: PROMPT_VERSION,
        sttModel: input.sttModel,
        llmModel,
        tokensUsed,
        durationMs: Date.now() - input.startedAt,
        generatedAt: new Date().toISOString(),
      },
    };

    this.logger.log(
      `Call ${input.callId} -> ${exitStatus} ` +
        `(${droppedClaims} claim(s) dropped, ${droppedSections.length} section(s) dropped, ` +
        `${tokensUsed} tokens)`,
    );

    return { notes, exitStatus, tokensUsed, llmModel };
  }
}
