# Evals

Offline evaluation of extraction quality. Metrics, gates, and the failure playbook are in
[`docs/Evals.md`](../docs/Evals.md); the decision behind them is ADR-015.

## Layout

```
evals/<section>/<call-name>.golden.json
```

| Directory | Section under test |
|-----------|--------------------|
| `objections/` | Objection extraction |
| `summary/` | Derived summary |
| `transcript/` | Transcription and diarization |
| `evidence/` | Matcher behaviour in isolation |
| `followup/` | Derived follow-up email |

## Ground truth is hand-authored

Golden files are written by a person against a real transcript. They are never generated,
and they are never derived from system output — grading a system against its own output
measures self-consistency, not correctness.

`scripts/seed.ts` writes stub fixtures into `sample-data/expected-output/`. Those exist so
the pipeline has something to run against during wiring. **They are not ground truth and
must not be used to grade quality.**

## Present today

| File | Status |
|------|--------|
| `objections/objection-call.golden.json` | Hand-authored: 5 positive cases, 6 negative |

Its transcript is `sample-data/transcripts/objection-call.json`, also hand-authored.

## Negative cases

Every golden file carries statements that were **never made** — plausible inferences,
paraphrase drift, and facts imported from domain knowledge rather than the call. If any
appears in output, the eval fails outright regardless of every other number.

Positive cases measure competence. Negative cases measure whether the evidence gate is
real. A suite without them reads as reassuring while proving nothing.

## Running

```bash
pnpm eval
pnpm eval --section objections
```

Runs in fixture mode (ADR-012): transcripts are fed directly, STT never runs, no provider
key required, results are deterministic.
