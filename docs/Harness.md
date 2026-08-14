# Harness

The harness is the part of ConvoRecall that decides what ships. Extractors propose;
the harness disposes. Everything in this document is normative — where another file
disagrees, this one wins (ADR-004).

Governed by ADR-002, ADR-006, ADR-007, ADR-009, ADR-011, ADR-013.

---

## Invariants

Six statements that must be true of every run. If a change breaks one, the change is
wrong, not the invariant.

| # | Invariant | Enforced by |
|---|-----------|-------------|
| 1 | Every job reaches a terminal state | Orphan reclaim (`docs/Jobs.md`) |
| 2 | Invalid model JSON never reaches a client | Schema gate |
| 3 | An unevidenced claim never reaches a client | Evidence gate |
| 4 | Retries are bounded and carry a reason | Retry classes |
| 5 | A job stops when its budget is spent, not when the model finishes | Budget governor |
| 6 | Every job leaves a record, including failures | `jobs` row written before work starts |

Invariant 1 is the one most easily faked. A job that is `extracting` forever technically
has a state; it does not have a *terminal* state. Reclaim is what makes this real.

---

## Pipeline

```
ingest
  │
  ├─ (fixture mode, ADR-012: enter here)
  ▼
transcribe ──────────────► transcript segments persisted
  │
  ▼
extract evidenced sections (parallel)
  │   objections · intent · nextSteps
  ▼
schema gate ─────────────► repair once, or drop section
  │
  ▼
evidence gate ───────────► drop unmatched claims, count them
  │
  ▼
synthesize derived sections (ADR-013)
  │   summary · followUpEmail
  │   input = surviving claims ONLY
  ▼
schema gate
  │
  ▼
resolve exit status ─────► persist notes + metadata
```

Two properties of this shape matter:

**Evidenced sections are extracted before derived sections are written.** The summary and
the follow-up email are synthesized from the claims that survived the gate, never from the
raw transcript. A dropped objection therefore cannot reappear in the email — the gate is
compositional rather than per-section. This supersedes the "extract all five in parallel"
ordering described in `docs/AI-Pipeline.md`.

**The gates run between the two stages, not at the end.** Gating after synthesis would
mean re-checking prose against a transcript, which is exactly the unreliable operation the
evidence design exists to avoid.

---

## Sections

| Section | Kind | Shape | Receipt |
|---------|------|-------|---------|
| `objections` | Evidenced | `Evidence[]` | One per item, mandatory |
| `intent` | Evidenced | `Evidence` | Mandatory |
| `nextSteps` | Evidenced | `Evidence[]` | One per item, mandatory |
| `summary` | Derived | `string` | None — constrained by input |
| `followUpEmail` | Derived | `string` | None — constrained by input |

Derived sections carry no receipts of their own. Their guarantee is different and comes
from ADR-013: they are generated from a prompt whose only factual input is the surviving
claim set, so they cannot assert anything that failed the gate.

---

## Schema gate

Every model response is parsed with the Zod schema for its section from
`packages/validators`. No free-text parsing, no partial salvage of a malformed object.

1. Parse. On success, continue.
2. On failure, invoke **schema repair** (below) exactly once.
3. If the repaired response also fails, the section is **dropped** and recorded in
   `droppedSections`.

A dropped section is not an error. It is a degraded but honest outcome that feeds exit
status resolution.

---

## Evidence gate

Applies to evidenced sections only. Full algorithm, normalization rules, and worked
examples live in `docs/Evidence-System.md`. The harness contract is:

- The model supplies `claim` and `quote`. Nothing else it says about position is trusted.
- The matcher resolves `quote` against the persisted transcript segments and derives
  `segmentIds`, `startMs`, `endMs`, and `speaker`.
- A claim whose quote does not resolve is **dropped** and `droppedClaims` increments.
- An empty evidenced section after gating counts as a dropped section.

`confidence` is optional and advisory (ADR-009). It never gates. A low-confidence claim
that resolved to a real span ships with a UI affordance; it is not dropped.

---

## Retry classes

Two mechanisms. They never nest — a schema repair is not retried on transport failure
beyond its own transport allowance, and a transport retry does not reset the repair count.

| | Transport retry | Schema repair |
|---|---|---|
| Triggers | Timeout, 429, 5xx, network error | Zod parse failure |
| Attempts | `TRANSPORT_RETRY_MAX` (3) | `SCHEMA_REPAIR_MAX` (1) |
| Backoff | Exponential 1s/2s/4s, jittered | None |
| Prompt | Byte-identical to the original | Repair prompt |
| Exhausted | Section fails → dropped | Section dropped |

Transport retry applies to **every** provider call — extraction and speech-to-text alike.
It was implemented only in the LLM client for a time, so a 5xx from the transcription
engine failed a job on the first attempt while this table claimed otherwise. The
classification lives in one place (`apps/api/src/common/retry.ts`) so the two cannot
drift again. Quota and billing failures are explicitly **not** retried: backoff cannot
buy credit, and retrying only delays the real cause.

The repair prompt may fix structure, coerce types, and delete invalid entries. It may not
introduce facts. A repair that adds a claim absent from the original response is a
regression and must be caught by a prompt test.

Worst case per section: 3 transport attempts plus 1 repair (itself allowed 3 transport
attempts). The token budget must accommodate this or the governor and the retry policy
will disagree about what is affordable.

---

## Budget governor

Three independent budgets. Any one hitting zero ends the job with `deadline`.

| Budget | Config | Default | Checked |
|--------|--------|---------|---------|
| Wall clock | `JOB_DEADLINE_MS` | 900 000 (15 min) | Before each stage and each model call |
| Tokens | `JOB_TOKEN_BUDGET` | 120 000 | Before each model call, against a projection |
| Per-request time | `LLM_REQUEST_TIMEOUT_MS` | 30 000 | Per call |
| | `STT_REQUEST_TIMEOUT_MS` | 600 000 | Per call |

The governor checks *before* spending, using a projection of the call's cost, rather than
detecting overspend afterwards. A projected call that would exceed the remaining budget is
not attempted.

Budget exhaustion is not a failure. Whatever has been produced and gated so far is
persisted and shown, and the job exits `deadline`. A user who hit a ceiling must be able
to distinguish that from a system that broke.

> `DEFAULT_JOB_TIMEOUT_MS = 120_000` in `packages/shared` predates this document and is
> too low for a real call. It must be replaced by `JOB_DEADLINE_MS` above.

---

## Exit status resolution

Ordered. First match wins. Evaluated once, after all gating and synthesis.

| Order | Status | Condition |
|-------|--------|-----------|
| 1 | `deadline` | Any budget exhausted before completion |
| 2 | `failed` | No section survived, or unrecoverable error (ingest, STT, no transcript) |
| 3 | `partial` | ≥1 section survived **and** (≥1 section dropped **or** `droppedClaims > 0`) |
| 4 | `shipped` | All five sections present and `droppedClaims == 0` |

`shipped` is a strict bar by design (ADR-011). One dropped claim yields `partial`.
`partial` is therefore the expected common case on real audio, and the UI must render it
as unremarkable rather than as a warning — see the note in `docs/Evidence-System.md` on
the sparse-notes failure mode.

---

## Notes metadata

Persisted with every notes payload regardless of exit status. A `partial` result that does
not say what is missing is worse than useless, because the reader cannot tell what they
are not seeing.

```ts
type NotesMetadata = {
  exitStatus: JobExitStatus;
  droppedClaims: number;
  droppedSections: string[];
  promptVersion: string;
  sttModel: string | null;
  llmModel: string;
  tokensUsed: number;
  durationMs: number;
  generatedAt: string;   // ISO 8601
};
```

`promptVersion`, `sttModel`, and `llmModel` are what make a result reproducible and a
regression attributable. They are not optional.

---

## Configuration

All values are configuration, never literals in feature code (ADR-003). Every key is
validated at startup; the application fails fast if a required key is missing.

| Key | Default |
|-----|---------|
| `JOB_DEADLINE_MS` | 900000 |
| `JOB_TOKEN_BUDGET` | 120000 |
| `LLM_REQUEST_TIMEOUT_MS` | 30000 |
| `STT_REQUEST_TIMEOUT_MS` | 600000 |
| `TRANSPORT_RETRY_MAX` | 3 |
| `SCHEMA_REPAIR_MAX` | 1 |
| `EVIDENCE_MATCH_THRESHOLD` | 0.85 |

---

## Test obligations

The harness is not implemented until these pass. They are the tests that distinguish a
real gate from a prompt instruction that says "please be accurate".

- [ ] Malformed JSON from the model never reaches a client response
- [ ] A repair that still fails produces a dropped section, not a partial object
- [ ] A fabricated quote (not present in the transcript) is dropped
- [ ] A quote spanning two transcript segments resolves successfully
- [ ] A dropped objection does not appear in the generated follow-up email (ADR-013)
- [ ] Exhausting the token budget yields `deadline`, not `failed`, and persists partial content
- [ ] A job killed mid-`extracting` is reclaimed and reaches a terminal state
- [ ] `droppedClaims > 0` yields `partial`, never `shipped`
