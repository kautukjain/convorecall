import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * PyAI Recap — the second half of the one-API build (`docs.pyai.com/use-cases/build-your-own-gong`).
 *
 * Hear turns audio into a diarized transcript; Recap turns that transcript into sales analysis.
 * Together they mean extraction needs no second vendor, which is what "runs on one API" requires.
 *
 * **The published schema understates what the sales pack returns.** The docs describe `record` as
 * `{tldr, summary, summary_draft, action_items}`. The live `sales_outbound` pack also returns
 * `objections`, `risk_signals`, `buying_signals`, `moments`, `analytics`, `competitor_mentions` and
 * `key_decisions` — and critically, the first three carry **verbatim quotes**, which is the only
 * reason Recap output can pass the evidence gate at all. The types below are written against
 * observed responses, and every field is optional because a pack may omit any of them.
 *
 * Two things learned the hard way and encoded here: the submit body wants **top-level
 * `utterances`** (nesting it under `transcript`, as the response shape implies, returns
 * `400 utterances must be a non-empty array`), and Recap is a **paid add-on** that answers `402
 * recap_not_enabled` until it is switched on for the organisation.
 */

/** A quoted finding. `text` on objections, `quote` on signals — same idea, different key. */
export type RecapQuoted = {
  text?: string;
  quote?: string;
  note?: string;
  category?: string;
  severity?: string;
};

export type RecapMoment = {
  category?: string;
  offset_s?: number;
  description?: string;
};

export type RecapRecord = {
  tldr?: string;
  summary?: string;
  summary_draft?: string;
  next_steps?: string;
  objections?: RecapQuoted[];
  risk_signals?: RecapQuoted[];
  buying_signals?: RecapQuoted[];
  key_decisions?: string[];
  moments?: RecapMoment[];
  action_items?: Array<{ owner?: string; task?: string; due?: string }>;
  competitor_mentions?: Array<{
    name?: string;
    context?: string;
    sentiment?: string;
    mentioned_by?: string;
  }>;
  analytics?: { talk_ratio?: number; filler_rate?: number; question_count?: number };
};

export type RecapCall = {
  call_id?: string;
  status?: "processing" | "complete" | "failed";
  headline?: string;
  record?: RecapRecord;
};

/** What Recap wants: role-labelled utterances with offsets. */
export type RecapUtterance = {
  speaker_role: "agent" | "caller";
  text: string;
  offset_s: number;
  duration_s: number;
};

/**
 * Speaker labels that mean "our side". Recap accepts only `agent` or `caller`, so a diarized label
 * has to be mapped onto that binary.
 *
 * This comment used to say a wrong role was "safe to get wrong", on the grounds that our evidence
 * gate re-derives the real speaker from the transcript and so a bad role cannot put the wrong name on
 * a shipped claim. The name part is true. The conclusion was not: the role is *input* to Recap, and
 * Recap's analysis depends on it. Told that every utterance came from the buyer, the sales pack read
 * the seller's own opening line — "I think that's everyone" — as a buying signal. Measured on
 * `enterprise-call`: submitted with roles, one clean signal; submitted all-`caller`, the preamble.
 *
 * So the mapping is still a heuristic, but a failed mapping is now a reported condition rather than a
 * silent default — see `rolesResolved`.
 *
 * **Anchored, not a substring search.** The previous pattern matched `\bsales\b` anywhere in the
 * label, which made `VP Sales` — the buyer's own decision-maker on `enterprise-call` — read as our
 * side. Buyer job titles routinely contain seller words, so only a label that *is* a seller role
 * counts. Verified against all five fixtures: `Rep`, `Support` and `Account Manager` still resolve to
 * agent, and `VP Sales` now correctly does not.
 */
const AGENT_LABEL =
  /^(rep|sales rep|agent|seller|ae|account executive|account manager|csm|support)$/i;

@Injectable()
export class RecapClient {
  private readonly logger = new Logger(RecapClient.name);
  private readonly cacheDir = resolve(process.cwd(), "../../.data/recap-cache");

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>("PYAI_API_KEY") && this.config.get<string>("PYAI_BASE_URL"),
    );
  }

  static toUtterances(
    segments: Array<{ speaker: string; text: string; startMs: number; endMs: number }>,
  ): RecapUtterance[] {
    return segments.map((segment) => ({
      speaker_role: AGENT_LABEL.test(segment.speaker.trim()) ? "agent" : "caller",
      text: segment.text,
      offset_s: segment.startMs / 1000,
      duration_s: Math.max(0, segment.endMs - segment.startMs) / 1000,
    }));
  }

  /**
   * Whether the role mapping actually identified two sides.
   *
   * A call where nothing matched `AGENT_LABEL` is submitted as if the buyer spoke every line. That is
   * the normal case for uploaded audio, not an edge case: PyAI diarization returns `Speaker 1..N`, and
   * if our naming step succeeded it returns personal names — neither looks like "rep". So the seller
   * disappears, and any Recap field that depends on knowing who was selling becomes unsound.
   *
   * Callers use this to decide what of the response they are entitled to trust. It deliberately does
   * not try harder to guess: which participant is the operator is not written down anywhere in a
   * recording, and inventing it is the failure this product exists to avoid.
   */
  static rolesResolved(utterances: RecapUtterance[]): boolean {
    let agent = false;
    let caller = false;
    for (const utterance of utterances) {
      if (utterance.speaker_role === "agent") agent = true;
      else caller = true;
      if (agent && caller) return true;
    }
    return false;
  }

  /**
   * Recap for a call, from cache when possible.
   *
   * Cached on disk because the key carries a **daily unit cap** (10 on the current plan) and a
   * Recap unit is metered per call. Re-running the demo or a measurement must not spend quota to
   * learn something it already knows.
   */
  async analyse(
    callId: string,
    utterances: RecapUtterance[],
    options: { force?: boolean } = {},
  ): Promise<RecapRecord | null> {
    const cached = options.force ? null : this.readCache(callId);
    if (cached) return cached;

    if (utterances.length === 0) return null;

    if (!(await this.submit(callId, utterances))) return null;

    const complete = await this.poll(callId);
    if (!complete?.record) return null;

    this.writeCache(callId, complete);
    return complete.record;
  }

  /** Kicks off analysis. `202` means queued; anything else is a real failure. */
  private async submit(callId: string, utterances: RecapUtterance[]): Promise<boolean> {
    const response = await this.request(callId, {
      method: "POST",
      body: JSON.stringify({ utterances }),
    });

    if (response?.ok) return true;

    const detail = response ? `${response.status}: ${await response.text()}` : "network error";
    // 402 is the one worth naming: Recap is a paid add-on and must be enabled per organisation.
    this.logger.warn(`Recap submit failed for ${callId} — ${detail.slice(0, 200)}`);
    return false;
  }

  private async poll(callId: string): Promise<RecapCall | null> {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      await new Promise((done) => setTimeout(done, attempt === 1 ? 1_500 : 3_000));

      const response = await this.request(callId, { method: "GET" });
      if (!response?.ok) continue;

      const call = (await response.json()) as RecapCall;
      if (call.status === "complete") return call;
      if (call.status === "failed") {
        this.logger.warn(`Recap failed for ${callId}`);
        return null;
      }
    }
    this.logger.warn(`Recap did not complete in time for ${callId}`);
    return null;
  }

  private async request(callId: string, init: RequestInit): Promise<Response | null> {
    const baseUrl = (this.config.get<string>("PYAI_BASE_URL") ?? "").replace(/\/+$/, "");
    try {
      return await fetch(`${baseUrl}/recap/calls/${encodeURIComponent(callId)}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.config.get<string>("PYAI_API_KEY") ?? ""}`,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      this.logger.warn(
        `Recap request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private cachePath(callId: string): string {
    return resolve(this.cacheDir, `${callId.replace(/[^a-zA-Z0-9-]/g, "_")}.json`);
  }

  private readCache(callId: string): RecapRecord | null {
    try {
      const call = JSON.parse(readFileSync(this.cachePath(callId), "utf8")) as RecapCall;
      return call.record ?? null;
    } catch {
      return null;
    }
  }

  private writeCache(callId: string, call: RecapCall): void {
    try {
      mkdirSync(this.cacheDir, { recursive: true });
      writeFileSync(this.cachePath(callId), `${JSON.stringify(call, null, 2)}\n`);
    } catch {
      /* A cache that cannot be written is a slower demo, not a broken one. */
    }
  }
}
