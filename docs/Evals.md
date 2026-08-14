# Evals

How extraction quality is measured. Governed by ADR-015. Normative (ADR-004).

Evidence accuracy is the differentiator. This document is what makes it falsifiable.

---

## Metrics

Measured per golden file, then aggregated.

| Metric | Definition | Gate |
|--------|------------|------|
| **Claim precision** | shipped claims whose quote genuinely supports the claim ÷ shipped claims | ≥ 0.95 |
| **Hallucination rate** | shipped claims with no basis in the transcript ÷ shipped claims | 0 |
| **Claim recall** | golden positive claims found ÷ golden positive claims | ≥ 0.60, tracked |
| **Span accuracy** | claims resolving to the correct segment ÷ matched claims | ≥ 0.98 |

**Precision and hallucination rate are release gates.** Recall is tracked and reported,
never gated.

That asymmetry is deliberate. A strict evidence gate trades recall for precision by design
(ADR-002). Gating recall would create steady pressure to loosen `EVIDENCE_MATCH_THRESHOLD`
until the gate stops doing its job — optimizing the metric by dismantling the product. If
recall drops below 0.60, that is a signal to investigate the transcript or the prompt, not
to relax the matcher.

**Hallucination rate must be exactly zero.** Not "low". One fabricated claim shipped with a
receipt that does not support it is worse than ten missing claims, because it teaches the
user that the receipts mean nothing.

---

## Ground truth

Hand-authored. Never generated.

> `scripts/seed.ts` writes stub files into `sample-data/expected-output/`. Those are
> fixtures for wiring, **not** ground truth. Grading against them measures whether the
> system agrees with itself.

A golden file carries two kinds of case:

**Positive** — a claim genuinely supported by the transcript, with the quote that supports
it and the segment it lives in. Counts toward recall. If shipped, it must resolve to the
recorded segment.

**Negative** — a plausible-sounding statement that was never made. Usually a reasonable
inference, a common paraphrase drift, or a fact from an adjacent domain. **If any negative
case appears in output, the eval fails outright**, regardless of every other metric.

Negative cases are the part that matters. Positive cases measure competence; negative cases
measure whether the gate is real. Without them, an eval suite reads as reassuring while
proving nothing.

---

## Format

```
evals/<section>/<call-name>.golden.json
```

```jsonc
{
  "callName": "objection-call",
  "transcript": "sample-data/transcripts/objection-call.json",
  "section": "objections",
  "authored": { "by": "human", "at": "2026-08-10" },

  "positive": [
    {
      "id": "obj-pricing",
      "claim": "Prospect cannot justify the pricing at current budget.",
      "quote": "we're not sure we can justify that pricing right now",
      "segmentId": "seg-8",
      "required": true          // must be found, else recall miss
    }
  ],

  "negative": [
    {
      "id": "neg-procurement",
      "claim": "Prospect needs procurement approval.",
      "why": "Finance was mentioned; procurement never was. Plausible drift."
    }
  ]
}
```

`required: false` marks a claim a competent extractor might reasonably miss — it counts
toward recall but its absence is not investigated.

---

## Running

```bash
pnpm eval                      # all golden files
pnpm eval --section objections # one section
```

Two modes. **Gate mode** (default) needs no model: it scores span accuracy and
hallucination rate against the golden files. **Live mode** (`--live`) runs the deployed
pipeline through the API and scores what it actually shipped.

Current results on the one golden file:

| Mode | Result |
|------|--------|
| Gate | 5/5 positives to the correct segment, 6/6 negatives rejected, span accuracy 100%, hallucination 0% |
| Live | `shipped`, 6–7 claims, **0 unresolved**, required recall 2/3–3/3 across four runs |

The runner exits non-zero on failure, so it can gate CI. Its own failure path is verified:
given a golden file whose "negative" case was in fact said, it reports the leak by id,
drops span accuracy, and exits 1.

## Recall is reported in two parts

Cases marked `required: false` are ones a competent extractor may reasonably miss.
Folding them into a single percentage makes a good run look worse than it is, so required
and total recall are printed separately.

## A single run is not a measurement

Across four identical live runs at temperature 0.2, the same transcript produced 3, 6, 6,
and 7 claims, with required recall between 2/3 and 3/3. Extraction is not deterministic,
and one number proves nothing.

Before treating a recall figure as real, average several runs or pin the provider's `seed`.
This matters most when judging a prompt change: a single run can easily show an
improvement that is noise.

**Hallucination rate does not vary** — it was 0 in every run, because it is structural.
The gate cannot ship a claim whose quote does not resolve. That is the difference between
a guarantee and a measurement.

Evals run in fixture mode (ADR-012): transcripts are fed directly and STT never runs. This
makes them deterministic, free, and runnable in CI without a provider key.

Temperature is pinned. `promptVersion` and `llmModel` are recorded with every result, so a
regression is attributable to the change that caused it.

---

## Interpreting a failure

| Symptom | Likely cause | Response |
|---------|--------------|----------|
| Precision < 0.95 | Matcher accepting weak matches | Raise `EVIDENCE_MATCH_THRESHOLD`; inspect the accepted spans |
| Hallucination > 0 | Gate bypassed, or a negative case matched a real span | **Stop.** Find the bypass before anything else |
| Recall < 0.60, precision fine | Prompt too conservative, or threshold too strict | Prompt first. Threshold only with precision evidence |
| Span accuracy < 0.98 | Cross-segment resolution or offset mapping | See the span resolution section of `docs/Evidence-System.md` |
| Recall collapses after a prompt edit | Prompt regression | Revert; the old version is still on disk by policy |

Never respond to a bad number by lowering a gate. The gates are the product.

---

## Phase 3 exit criteria

Phase 3 is not done until:

- [ ] One hand-authored golden file exists with both positive and negative cases
- [ ] `pnpm eval` runs it in fixture mode with no provider key
- [ ] Hallucination rate is 0
- [ ] Claim precision ≥ 0.95
- [ ] Recall is recorded, whatever it is

One golden file, passing, beats five stub files that measure nothing. Authoring one takes
60–90 minutes, which is why exactly one is required to exit the phase.

## Deferred

Golden set size beyond the first file, per-section thresholds, and CI enforcement of the
gates are open (`docs/Decisions.md`). The metric definitions above are fixed.
