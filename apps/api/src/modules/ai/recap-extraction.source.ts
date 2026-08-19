import type { DerivedSection, EvidencedSection } from "@convorecall/prompts";
import type { ClaimCandidate, UncitedNotes } from "@convorecall/types";
import type { SectionOutcome } from "./ai-orchestrator.service.js";
import type { ExtractionSource } from "./extraction-source.js";
import type { RecapQuoted, RecapRecord } from "./recap.client.js";

/** Recap is metered per call, not per token, and the cost is paid before this runs. */
const NO_USAGE = { promptTokens: 0, completionTokens: 0 } as const;

/**
 * Turns a Recap record into the shape the extraction harness already consumes.
 *
 * This is what `ExtractionSource` is for: `NotesService` cannot tell whether a claim came from a
 * model, a recording, or PyAI, so the evidence gate, the section-drop accounting and the exit
 * status behave identically. Recap output earns its place on the page the same way everything else
 * does — by resolving to a real span of the transcript.
 *
 * What makes Recap usable is that its sales pack quotes the call. `objections[].text`,
 * `risk_signals[].quote` and `buying_signals[].quote` are verbatim, so they resolve. Measured on
 * `objection-call`: 3 candidates, 3 kept, 0 dropped.
 *
 * Where it declines rather than guesses:
 *
 * - **`action_items` carry no position** — `{owner, task, due}` and nothing else. Note what this does
 *   and does not mean. The commitment is usually spoken plainly: "Send a real call recording" is
 *   Marcus at 2:42 on `discovery-call` and "I'll turn it round same day" is the Rep six seconds
 *   later. What Recap withholds is the line, not the fact. Our matcher resolves quotes rather than
 *   meanings, so a paraphrase gives it nothing to work with: measured 0 of 34 surviving at thresholds
 *   0.85, 0.70 and even 0.55. Dropping the threshold further would not find the right line, it would
 *   pick whichever line shares the most words — which is how a receipt lands on the wrong turn. So
 *   these are surfaced uncited (see `uncited()`) and evidenced next steps are left to the model.
 * - **`moments` look like a position and are not one.** They carry `offset_s`, but four of eighteen
 *   observed offsets fell *past the end of the call* (enterprise-call: 100, 200, 300 for a 175s
 *   call). Resolving against those would put receipts on the wrong lines.
 * - **There is no follow-up email.** The section is reported missing rather than invented, so the
 *   harness drops it and the exit status says `partial` — the honest outcome for a section nothing
 *   produced.
 */
export class RecapExtractionSource implements ExtractionSource {
  /**
   * `rolesResolved` says whether Recap was told who was selling. It is not a detail: see
   * `claimsFor("intent")`, which refuses to ship buying signals when it was not.
   */
  constructor(
    private readonly record: RecapRecord,
    private readonly rolesResolved: boolean,
  ) {}

  /**
   * Recap's action items and next-steps prose, kept rather than discarded.
   *
   * These are genuinely useful — task, owner, due date — and genuinely uncitable, because Recap gives
   * them no quote to place them by. Uncitable, not unverifiable: a reader can check them against the
   * transcript in a few seconds, and they usually hold. Earlier they were simply dropped, which lost real
   * information and left the page reading "0 next steps" while the vendor had produced three.
   * ADR-002 permits inferential output when it is separately labelled, so they are returned here
   * and rendered apart from anything the gate approved.
   */
  uncited(): UncitedNotes | null {
    const actionItems = (this.record.action_items ?? [])
      .filter((item): item is { task: string; owner?: string; due?: string } =>
        Boolean(item.task?.trim()),
      )
      .map((item) => ({
        task: item.task.trim(),
        owner: item.owner?.trim() || undefined,
        due: item.due?.trim() || undefined,
      }));

    const nextSteps = this.record.next_steps?.trim() || undefined;

    // `key_decisions` was arriving in every response and being discarded here. It is the section a
    // reader looks at first on Recap's own dashboard, so dropping it made our page look like the
    // vendor had returned less than it did.
    const keyDecisions = (this.record.key_decisions ?? [])
      .map((decision) => decision?.trim() ?? "")
      .filter((decision) => decision.length > 0);

    if (actionItems.length === 0 && !nextSteps && keyDecisions.length === 0) return null;

    return {
      source: "pyai-recap",
      actionItems,
      nextSteps,
      ...(keyDecisions.length > 0 ? { keyDecisions } : {}),
    };
  }

  extractClaims(section: EvidencedSection): Promise<SectionOutcome<ClaimCandidate[]>> {
    return Promise.resolve({
      ok: true,
      value: this.claimsFor(section),
      usage: NO_USAGE,
      // Names the provenance, so an export can never imply a model wrote this.
      model: "pyai-recap",
    });
  }

  synthesize(section: DerivedSection): Promise<SectionOutcome<string>> {
    if (section === "summary") {
      // `summary` is frequently empty on the sales pack while `tldr` is populated.
      const summary = firstNonEmpty(
        this.record.summary,
        this.record.summary_draft,
        this.record.tldr,
      );
      return Promise.resolve(
        summary
          ? { ok: true, value: summary, usage: NO_USAGE, model: "pyai-recap" }
          : { ok: false, reason: "not_provided_by_recap", usage: NO_USAGE },
      );
    }

    // Recap writes no email, but it does return everything an email is made of. Composing one from
    // its own summary and action items is assembly, not generation: every sentence below is either
    // Recap's text verbatim or fixed scaffolding. Nothing is invented, and no model is involved.
    //
    // The body deliberately stops before a sign-off. `composeEmail` in the harness adds the greeting
    // from the gate-resolved recipient and never signs, because nothing in a call identifies which
    // participant is the operator.
    const email = this.composeEmailBody();
    return Promise.resolve(
      email
        ? { ok: true, value: email, usage: NO_USAGE, model: "pyai-recap" }
        : { ok: false, reason: "not_provided_by_recap", usage: NO_USAGE },
    );
  }

  /**
   * A follow-up body assembled from Recap's fields.
   *
   * Worth being explicit about what this is not: it is not a synthesis of gated survivors, which is
   * what ADR-013 describes. Recap's action items were never gated — they carry no quote to test — so
   * a draft built from them contains uncited commitments. That is disclosed on the page rather than
   * hidden, and a human sends the email either way.
   */
  private composeEmailBody(): string {
    const opening = firstNonEmpty(this.record.summary, this.record.summary_draft, this.record.tldr);
    const items = (this.record.action_items ?? [])
      .map((item) => ({ task: item.task?.trim() ?? "", due: item.due?.trim() }))
      .filter((item) => item.task.length > 0);

    const parts: string[] = [];
    if (opening) parts.push(`Thank you for the conversation. ${opening}`);

    if (items.length > 0) {
      const lines = items.map((item) => `- ${item.task}${item.due ? ` (${item.due})` : ""}`);
      parts.push(["As agreed, the next steps are:", ...lines].join("\n"));
    }

    // An email with a greeting and nothing else is worse than no draft at all.
    return parts.length > 0 ? parts.join("\n\n") : "";
  }

  private claimsFor(section: EvidencedSection): ClaimCandidate[] {
    if (section === "objections") {
      // Objections and risk signals are the same claim seen twice on a sales call; both are quoted,
      // and the gate collapses them by resolving both to the same segment.
      return [
        ...quoted(this.record.objections, (item) => item.note ?? "Objection raised"),
        ...quoted(this.record.risk_signals, (item) =>
          item.category ? `Risk: ${humanise(item.category)}` : "Risk raised",
        ),
      ];
    }

    if (section === "intent") {
      /*
       * A buying signal is the closest thing Recap reports to intent, and it is quoted — but it is
       * only meaningful if Recap knew which side was buying.
       *
       * Submitted all-`caller`, the sales pack returned `{quote: "I think that's everyone",
       * category: "Interest"}` — the seller's opening line, the moment before anyone had said
       * anything. It cleared the evidence gate, because the gate asks whether the quote is real and
       * where it is, and the quote was real and at 0:00. Nothing downstream can catch that: to a
       * matcher, a claim about the buyer's interest attached to the seller's greeting looks exactly
       * like a claim attached to its proof.
       *
       * So the check has to happen here, where the defect is knowable. With no roles, this field is
       * not evidence of intent and is not shipped as such. The section drops, the exit status says
       * `partial`, and in composite mode the model answers instead.
       */
      if (!this.rolesResolved) return [];

      return quoted(this.record.buying_signals, (item) =>
        item.category ? `Buying signal: ${humanise(item.category)}` : "Buying signal",
      );
    }

    // Next steps: Recap gives no quote for them, so there is nothing for the gate to place. The
    // commitments themselves are generally in the call — see the note on `action_items` above — which
    // is why they come back from `uncited()` rather than being dropped.
    return [];
  }
}

function quoted(
  items: RecapQuoted[] | undefined,
  claimOf: (item: RecapQuoted) => string,
): ClaimCandidate[] {
  return (items ?? [])
    .map((item) => ({ claim: claimOf(item), quote: (item.text ?? item.quote ?? "").trim() }))
    .filter((candidate) => candidate.quote.length > 0);
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find((value) => value && value.trim().length > 0)?.trim() ?? "";
}

/** `budget_constraint` reads as "budget constraint" on a page a human looks at. */
function humanise(value: string): string {
  return value.replace(/[_-]+/g, " ").trim();
}

/**
 * PyAI first, the model for what PyAI cannot evidence.
 *
 * Used when `LLM_ENABLED=true`. Per section, Recap wins if it produced anything, because its claims
 * are quoted and therefore checkable; the model fills the gaps — intent when there was no buying
 * signal, next steps always, and the follow-up email.
 *
 * The order matters beyond preference: a section sourced from Recap costs no tokens and is already
 * verifiable, so spending model tokens to re-derive it would buy a differently-worded claim and no
 * more truth. Measured across the five sample calls: 29 claims for ~2,050 tokens a call, against 30
 * claims for ~4,280 with the model alone, and nothing dropped either way.
 */
export class CompositeExtractionSource implements ExtractionSource {
  constructor(
    private readonly recap: ExtractionSource,
    private readonly llm: ExtractionSource,
  ) {}

  /** Recap's, since the model has none — it is asked for quotes and its claims are gated. */
  uncited(): UncitedNotes | null {
    return this.recap.uncited?.() ?? null;
  }

  async extractClaims(
    section: EvidencedSection,
    segments: Array<{ speaker: string; text: string }>,
  ): Promise<SectionOutcome<ClaimCandidate[]>> {
    const fromRecap = await this.recap.extractClaims(section, segments);
    if (fromRecap.ok && fromRecap.value.length > 0) return fromRecap;
    return this.llm.extractClaims(section, segments);
  }

  async synthesize(
    section: DerivedSection,
    claims: Array<{ section: string; claim: string; quote: string }>,
  ): Promise<SectionOutcome<string>> {
    // Derived sections are prose. The model writes better prose than a headline field, and it is
    // the only one of the two that writes an email at all.
    const fromLlm = await this.llm.synthesize(section, claims);
    if (fromLlm.ok) return fromLlm;
    return this.recap.synthesize(section, claims);
  }
}
