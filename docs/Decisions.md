# Decisions

Architecture Decision Records for ConvoRecall.

`docs/` is the normative source of truth for this project (see ADR-004). Where any
other file disagrees with an accepted ADR, the ADR wins and the other file is a bug.

**Status values:** `Accepted` · `Superseded` · `Deferred`

| ADR | Title | Status | Unblocks |
|-----|-------|--------|----------|
| 001 | Monorepo | Accepted | Phase 0 |
| 002 | Evidence-first notes | Accepted | Phase 3 |
| 003 | OpenAI-compatible PyAI client | Accepted | Phase 2 |
| 004 | `docs/` is normative, rules are style-only | Accepted | All |
| 005 | NestJS + Prisma backend | Accepted | Phase 0–1 |
| 006 | Terminal state vocabulary | Accepted | Phase 1–3 |
| 007 | Two retry classes | Accepted | Phase 2–3 |
| 008 | Job execution model | Accepted | Phase 1 |
| 009 | Evidence contract | Accepted | Phase 3 |
| 010 | API surface and error format | Accepted | Phase 1 |
| 011 | Exit status thresholds | Accepted | Phase 3 |
| 012 | Fixture mode is a first-class ingest path | Accepted | Phase 2 |
| 013 | Evidenced vs derived sections | Accepted | Phase 3 |
| 014 | Web stack | Accepted | Phase 4 |
| 015 | Evidence quality metric | Accepted | Phase 3 exit |

---

## ADR-001: Monorepo

**Status:** Accepted

**Context.** Web, API, prompts, and types change together during a short build. Separate
repos would mean version-bumping shared contracts across three of them mid-hackathon.

**Decision.** pnpm workspaces + Turborepo. `apps/web`, `apps/api`, and shared libraries
under `packages/*`.

**Consequences.** Shared types and Zod schemas are imported directly, so a contract change
breaks the build immediately rather than at runtime. One clone gets a contributor running.
Cost: Turborepo caching and workspace protocol are one more thing a contributor must
understand, and a lockfile is mandatory for CI.

**Rejected.** Single package (no boundary between web and API contracts). Polyrepo
(coordination cost exceeds any benefit at this size).

---

## ADR-002: Evidence-first notes

**Status:** Accepted

**Context.** The market is saturated with LLM wrappers that summarize a call and are
confidently wrong. The reason a rep does not trust generated notes is that they cannot
check them. Checkability is the product.

**Decision.** A claim ships only if it carries a receipt that resolves to a real span of the
transcript. Claims that cannot be matched are dropped, never softened, never guessed at.
The gate is mechanical, not a prompt instruction — see ADR-009.

**Consequences.** This is the one rule that may not be relaxed for demo convenience. It
implies a visible failure mode: a poor transcript produces sparse notes rather than
plausible ones. That trade is deliberate and is designed for explicitly in
`docs/Evidence-System.md`. It also implies every extractor must be able to quote, which
constrains prompt design (ADR-009) and rules out purely inferential outputs like sentiment
scores unless they are separately labelled as unevidenced.

**Rejected.** Model-reported confidence as the only guard (self-assessed confidence is not
correlated with correctness). Post-hoc human review (no reviewer exists in a self-hosted
OSS tool).

---

## ADR-003: OpenAI-compatible PyAI client

**Status:** Accepted

**Context.** The kit is meant to be forked and self-hosted. Hard-coding one vendor's SDK
makes every fork a rewrite.

**Decision.** All model access goes through an OpenAI-compatible client, configured by
`PYAI_BASE_URL`, `PYAI_API_KEY`, and model IDs from env. Model IDs are configuration and
never appear as literals in feature code. STT and LLM are separate capability entries so
they can point at different providers.

**Consequences.** Swapping providers is an env change. Any provider-specific feature
(diarization formats, timestamp granularity, streaming semantics) must be normalized at
the adapter boundary, so the adapter owns a real translation layer rather than being a thin
passthrough.

**Spike 2a result (2026-08-10): resolved, with one significant correction.**

The synchronous OpenAI-compatible endpoint `POST /v1/audio/transcriptions` returns only
`{text, duration}` — **no segments, no timestamps, no speakers** — regardless of
`response_format`, `timestamp_granularities`, or any diarization parameter. It cannot
support the evidence system.

Diarized, timestamped output comes from the **async job API**: `POST /v1/transcription/jobs`
with `diarize=true`, polled at `GET /v1/transcription/jobs/{id}`. That returns `segments`
with `start`, `end`, `text`, and `speaker`, plus word-level timings.

Verified against a generated two-speaker recording: 2 speakers correctly separated at the
true 4.32s boundary, ~3s turnaround for 9.6s of audio.

Consequences:

- The STT adapter polls a job rather than awaiting a response. This is why transcription
  belongs to the worker — an HTTP request could not wait for it, and the job row already
  exists to hold the state (ADR-008).
- Config was wrong in two places: base URL needs the `/v1` suffix, and the model id is
  `pyai-hear`, not `hear`. Both corrected in `.env.example`.
- Transcripts come back **lowercase and unpunctuated**, which raises the importance of
  normalization in `docs/Evidence-System.md` from convenience to load-bearing.
- Word-level timestamps *are* available, so the constraint cited in ADR-009 for choosing
  segment granularity no longer holds. Segment granularity is retained anyway — it is
  sufficient for click-to-highlight — but the choice is now a preference, not a limit.

**Phase 3 finding: PyAI serves speech, not text generation.** There is no
`/v1/chat/completions` (verified: 404 `unknown_route`, and no such path exists in the
90-endpoint OpenAPI spec). PyAI is Hear/Speak/Omni/AMD/Recap/Telephony. The
`PYAI_LLM_MODEL=gpt-4o-mini` in the original config was never meaningful.

This is why this ADR specifies STT and LLM as **separate capability entries**, and that
separation now carries weight rather than being theoretical. Extraction is configured
independently via `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, against any
OpenAI-compatible endpoint.

Their `/v1/recap/calls` endpoint does summarize calls, and was deliberately not used:
handing summarization to a vendor black box would remove the evidence gate, which is the
one thing ADR-002 says may not be traded away.

**Rejected.** Direct vendor SDKs. A heavyweight abstraction layer over multiple providers
(premature; the OpenAI shape is the de facto interface).

---

## ADR-004: `docs/` is normative, rules are style-only

**Status:** Accepted

**Context.** The repository grew four parallel instruction hierarchies with equal
authority — `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/*`, and `docs/*` — each asserting
architectural facts. They drifted into direct contradiction on terminal states, retry
policy, evidence shape, API format, and folder layout. An agent's output depended on which
file it happened to read.

**Decision.** One authority ladder:

| Layer | Owns | May not contain |
|-------|------|-----------------|
| `docs/` | Contracts, schemas, state machines, algorithms, API surface | — |
| `.cursor/rules/*` | Naming, file/function size, DI idiom, error-handling style, test conventions | Any architectural assertion |
| `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md` | Mission, hard constraints, reading order | Stack claims, state machines, contracts |

A rule file that needs to reference an architectural fact links to the owning doc instead
of restating it. Restating is how drift happens.

**Consequences.** The 13 rule files lose their architecture sections and shrink
substantially. Contributors and agents get one place to look. Verification is mechanical:
grep the repo for contested terms and confirm every hit agrees.

**Rejected.** Rules as canonical (buries architecture inside agent config, invisible to
human contributors). One merged playbook (loses Cursor's per-glob targeting).

---

## ADR-005: NestJS + Prisma backend

**Status:** Accepted — supersedes the "Node/TypeScript" description in `CLAUDE.md`

**Context.** `.cursor/rules/backend.mdc` mandated NestJS + Prisma, `CLAUDE.md` said plain
Node/TypeScript, and `apps/api` shipped a raw `node:http` server. The module tree under
`apps/api/src` was already Nest-shaped (`guards/`, `filters/`, `interceptors/`, `pipes/`).

**Decision.** NestJS with Prisma over Postgres. The existing `apps/api/src` layout is
correct and stays. `apps/api/src/index.ts` is a Phase 0 placeholder and is replaced by a
Nest bootstrap in `main.ts`.

**Consequences.** Structure, DI, guards, interceptors, and validation pipes come with the
framework rather than being hand-rolled, which matters for a repo meant to look
maintained. Cost is real and front-loaded: Nest plus Prisma bootstrap consumes a
meaningful slice of Phase 0, and this is the single largest schedule risk to the demo. It
raises the priority of the pre-agreed cut list in `PROJECT_STATE.md`.

Follow-on corrections required: `CLAUDE.md` stack line; `.cursor/rules/architecture.mdc`,
whose "feature-first only, `controllers/`/`services/` incorrect" folder law contradicts
both Nest convention and the actual tree; `apps/api/package.json` dependencies.

**Rejected.** Fastify + Prisma (faster to a demo, but discards the existing module tree and
the backend rulebook). Staying on `node:http` (multipart upload, validation, rate limiting,
and SSE would all be hand-rolled).

**Amendment (Phase 0, 2026-08-10): Prisma pinned to 6.x.** Prisma 7 removes `url` from the
datasource block, requiring a `prisma.config.ts` plus a driver adapter, and `@prisma/config`
does not resolve under this pnpm layout. Version 6 is current-minus-one, still supported,
and is what all existing documentation assumes — which is worth more to a fork-and-read
project than being on the newest major. Revisit post-demo; the schema is unaffected.

**Amendment (Phase 0): Postgres binds host port 5433.** 5432 was already held by a locally
installed Postgres, and Prisma reported the collision as `P1010 denied access` rather than
anything pointing at the real cause. Anyone with a local Postgres would hit this on first
run.

---

## ADR-006: Terminal state vocabulary

**Status:** Accepted

**Context.** Two vocabularies were in force. `.cursor/rules/*` mandated
`READY | FAILED | PARTIAL` and forbade additional terminal states; `README.md`,
`docs/Architecture.md`, and `packages/types` used `shipped | partial | failed | deadline`.

**Decision.** The job state machine is:

```
queued -> transcribing -> extracting -> (shipped | partial | failed | deadline)
```

`READY` is deleted from the vocabulary. Four terminal states, defined:

| State | Meaning |
|-------|---------|
| `shipped` | Complete notes, every claim evidenced |
| `partial` | Usable notes, some sections or claims dropped |
| `failed` | Nothing usable produced, or an unrecoverable error |
| `deadline` | A time or token budget was exhausted before completion |

**Consequences.** `deadline` is kept as distinct from `failed` because the budget governor
is a headline invariant and "we stopped on purpose" is operationally different from "it
broke" — they need different UI copy, different retry advice, and different alerting.
Thresholds between these states are defined in ADR-011, not left to implementer judgement.
`packages/types` already matches and needs no change.

**Rejected.** Three states (loses the budget signal that the harness exists to provide).

---

## ADR-007: Two retry classes

**Status:** Accepted

**Context.** `.cursor/rules/ai.mdc` said "never retry invalid JSON, max 3 retries with
exponential backoff." `docs/AI-Pipeline.md` and `packages/shared` said invalid JSON is
retried exactly once with a repair prompt. Read as one mechanism these are contradictory.
They are two mechanisms.

**Decision.** Name them separately. They never nest.

| | Transport retry | Schema repair |
|---|---|---|
| Triggers on | Timeout, 429, 5xx, network failure | Response that fails Zod parse |
| Attempts | 3 | Exactly 1 |
| Backoff | Exponential, 1s/2s/4s, jittered | None |
| Prompt | Identical to the original | Repair prompt: fix shape only |
| On exhaustion | Section fails | Section is dropped |

The repair prompt may correct structure and drop invalid entries. It may not introduce
facts. A repaired response that still fails validation is discarded, never partially
salvaged.

Timeouts: 30s per LLM request, 10 min per STT request, and a whole-job deadline. Note that
`DEFAULT_JOB_TIMEOUT_MS = 120_000` in `packages/shared` is too low for a long call and must
be revised alongside `docs/Harness.md`.

**Consequences.** Worst case for one section is 3 transport attempts plus 1 repair. That
bound must be reflected in the token budget or the governor and the retry policy will
disagree about what is affordable.

**Rejected.** A single unified retry counter (conflates a network blip with a model that
cannot follow a schema — they want different responses).

---

## ADR-008: Job execution model

**Status:** Accepted

**Context.** The harness promises that every job leaves a record and never silently hangs.
Analysis takes minutes, so it cannot run inside a request. No queue technology, worker
process, or progress transport had been chosen, which blocked Phase 1.

**Decision.**

- **Durable record:** a `jobs` table in Postgres. The row is created before any work
  starts and is the single source of truth for job state.
- **Execution:** an in-process worker inside the Nest API, claiming rows with
  `SELECT ... FOR UPDATE SKIP LOCKED`. Concurrency is configurable and defaults low.
- **Liveness:** the worker writes `heartbeat_at` while running. Rows whose heartbeat has
  gone stale past a threshold are reclaimable.
- **Recovery:** on startup, non-terminal jobs with a stale heartbeat are reclaimed or
  marked `failed` with reason `orphaned`. A crash can therefore never leave a job
  permanently in `extracting`, which is what makes the failure invariant true rather than
  aspirational.
- **Progress:** Server-Sent Events at `GET /api/v1/calls/:id/events`. State transitions
  and section-level completion are pushed. Polling `GET /api/v1/calls/:id` remains a valid
  fallback for clients that cannot hold a connection.

**Consequences.** No Redis, no third app in the monorepo, no extra deployment target — a
fork needs only Postgres. The trade is that the API process does CPU and network work
alongside serving requests, which is acceptable at demo and self-host scale and is a known
scaling wall. Moving to a separate worker later is a deployment change, not a redesign,
because the queue is already a table and the claim is already atomic.

**Rejected.** Redis + BullMQ with a separate worker app (real queue semantics, but a third
service in every deployment for load this project will not see). Inline processing with
client polling (HTTP timeouts on long calls, and work is lost on restart — it breaks the
failure invariant directly).

---

## ADR-009: Evidence contract

**Status:** Accepted

**Context.** Three definitions were in circulation. `ai.mdc` required `line`, `timestamp`,
`speaker`, and `confidence` as mandatory. `docs/Evidence-System.md` and `packages/types`
made everything optional and had no `confidence` field. `packages/shared` implemented
matching as an exact normalized substring test while the docs described it as fuzzy.

**Decision.** One contract:

- **Mandatory on every claim:** `claim`, `quote`, and a resolved span (`segmentIds` plus
  `startMs`/`endMs`). The span is *derived by the matcher*, not supplied by the model. The
  model supplies only `claim` and `quote`; anything it asserts about position is ignored.
- **`speaker`:** derived from the matched segment, not model-supplied.
- **`confidence`:** optional, `0..1`, advisory only. It never gates shipping. Its purpose
  is the low-confidence affordance described below.
- **Matching:** normalized exact substring first (lowercase, whitespace collapsed,
  boundary punctuation stripped). Fallback to windowed token similarity above a stated
  threshold, evaluated across segment boundaries so a quote spanning two segments still
  resolves. Both stages and the threshold are specified with worked examples in
  `docs/Evidence-System.md`.
- **No match:** the claim is dropped and a `droppedClaims` counter increments. The counter
  feeds ADR-011.

**Consequences.** Because the model cannot assert position, it cannot fabricate one — the
strongest available hallucination guard, and the reason position is derived rather than
trusted. Keeping `confidence` optional and advisory gives the UI a way to surface a weak
but genuinely evidenced claim instead of the binary drop, which is the designed mitigation
for sparse-notes-on-a-bad-transcript. `packages/types` needs `confidence` added as
optional; `transcriptContainsQuote` in `packages/shared` needs the fallback stage and must
return the matched span rather than a boolean.

**Rejected.** Mandatory model-supplied confidence (invites fabricated precision).
Model-supplied line numbers (unverifiable and routinely wrong). Exact-match only (a model
that lightly paraphrases loses correct claims, and the sparse-notes failure mode gets
materially worse).

---

## ADR-010: API surface and error format

**Status:** Accepted

**Context.** `.cursor/rules/backend.mdc` mandated an `/api/v1` prefix and a
`{success, data, error, metadata}` envelope on every response. `docs/API.md` used
unprefixed paths, `{ok: true}`, and `{error: {code, message}}`.

**Decision.**

- **Versioning:** all endpoints under `/api/v1`. Free now, expensive to retrofit in a repo
  meant to be forked.
- **Success bodies:** the resource itself, unwrapped. No `success` boolean — HTTP status
  already carries it.
- **Errors:** RFC 9457 `application/problem+json`, with a stable machine-readable `code`.
  Never leaks stack traces, SQL, internal paths, or secrets.
- **Health:** `GET /api/v1/health` returns `{ok: true}` and is exempt from the error
  envelope discussion by virtue of not erroring.

**Consequences.** Every client does one status check and one parse instead of unwrapping
twice. `backend.mdc`'s envelope section is deleted under ADR-004. `docs/API.md` is rewritten
against this decision and gains the SSE and share routes it currently lacks.

**Rejected.** The `{success, data, metadata}` envelope (duplicates HTTP semantics and adds a
layer to every client). Unversioned paths (docs' current state, but a fork-hostile default).

---

## ADR-011: Exit status thresholds

**Status:** Accepted

**Context.** ADR-006 defines four terminal states. Without numeric thresholds, "partial"
becomes implementer judgement and the same job could exit differently on two runs.

**Decision.** Evaluated in this order — first match wins:

1. **`deadline`** — a wall-clock or token budget was exhausted before completion. Takes
   precedence over any other outcome, and whatever content survived is still persisted and
   shown. A user who hit a budget must be able to tell that from a failure.
2. **`failed`** — no section survived its gates, or an unrecoverable error occurred
   (ingest failure, STT failure, no transcript).
3. **`partial`** — at least one section survived, and at least one section was dropped or
   at least one claim was dropped by the evidence gate.
4. **`shipped`** — all five sections present, `droppedClaims == 0`.

The notes payload always records `droppedClaims` and the set of dropped sections, whatever
the exit status. A `partial` result that does not say what is missing is worse than useless
because the reader cannot tell what they are not seeing.

**Consequences.** `shipped` is a strict bar — a single dropped claim produces `partial`.
That is intended: `partial` is the honest common case for real audio, and treating it as
normal rather than degraded is what makes the evidence gate survivable. The UI must
therefore make `partial` look unremarkable rather than alarming.

**Rejected.** A percentage threshold for `shipped` (invites a "95% is fine" habit, which is
precisely the trust erosion ADR-002 exists to prevent).

---

## ADR-012: Fixture mode is a first-class ingest path

**Status:** Accepted

**Context.** The demo depends on live STT over conference wifi against an unverified
provider (ADR-003). `docs/Demo.md` already names an offline fallback, but a fallback that
is not exercised in normal development does not work when it is needed.

**Decision.** Analysis accepts a pre-existing transcript as a legitimate entry point, not a
test hack. A job may start at `extracting` with a transcript supplied from
`sample-data/transcripts/`, skipping ingest and STT. The same gates, retries, budgets, and
exit statuses apply. Fixture mode is the default in tests and evals.

**Consequences.** Phase 3 can be built and evaluated before Phase 2 works, which removes
the STT provider from the critical path for the harness. The demo has a rehearsed rather
than theoretical fallback. It also makes evals deterministic, since the eval suite feeds
transcripts directly and never touches STT.

This decision is load-bearing for the schedule: the five sample audio files in
`sample-data/audio/` are currently 0 bytes, so fixture mode is at present the *only* path
that can work end to end.

---

## ADR-013: Evidenced vs derived sections

**Status:** Accepted — raised while writing `docs/Harness.md`, not present in the original
planning set

**Context.** ADR-002 requires a receipt for every claim. ADR-011 requires five sections.
Three of those sections are naturally claim-shaped (`objections`, `intent`, `nextSteps`);
two are prose (`summary`, `followUpEmail`). Prose cannot carry a per-item receipt, and
checking generated prose against a transcript after the fact is exactly the unreliable
operation the evidence design exists to avoid. Left unresolved, each extractor author
would have invented a different answer.

**Decision.** Two categories with different guarantees.

| Kind | Sections | Guarantee |
|------|----------|-----------|
| Evidenced | `objections`, `intent`, `nextSteps` | Every item carries a resolved receipt (ADR-009) |
| Derived | `summary`, `followUpEmail` | No receipts; synthesized from surviving claims only |

Derived sections are generated in a **second pass** whose only factual input is the claim
set that survived the evidence gate. The raw transcript is not provided to those prompts.

**Consequences.** A dropped objection cannot reappear in the follow-up email, because the
email prompt never saw it — the gate composes forward instead of needing to be re-run
against prose. This changes the pipeline shape described in `docs/AI-Pipeline.md`, which
has extraction of all five sections in parallel; extraction is now parallel *within* the
evidenced stage, followed by gating, followed by synthesis. `docs/AI-Pipeline.md` must be
corrected to match.

Cost: one extra sequential model call on the critical path, and summary quality is bounded
by what survived the gate. On a poor transcript the summary is thin rather than fluent —
consistent with ADR-002, and the honest outcome.

**Rejected.** Receipts on every sentence of the summary (unreadable, and sentence-level
attribution of synthesized prose is not meaningful). Generating all five in parallel from
the transcript and gating prose afterwards (requires checking prose against a transcript,
which is the unreliable operation being avoided). Dropping the summary entirely (it is
what a rep actually reads first).

---

## ADR-014: Web stack

**Status:** Accepted

**Context.** The backend stack got an ADR (005); the frontend never did. Its stack was
asserted only in `.cursor/rules/frontend.mdc`, which under ADR-004 is not allowed to own an
architectural fact — leaving `docs/Architecture.md` citing a rule file as its source.

**Decision.** Next.js App Router, TypeScript strict, TailwindCSS, shadcn/ui, TanStack
Query, React Hook Form + Zod. Shared primitives in `packages/ui`. No second UI framework.

Zod is shared with the API through `packages/validators`, so the notes payload is validated
against the same schema on both sides. A contract drift becomes a type error rather than a
runtime surprise.

**Consequences.** `apps/web` currently has none of these as dependencies — it is a
hand-rolled `node:http` server returning an HTML string, and that placeholder is replaced
in Phase 0, not extended. shadcn/ui is vendored into the repo rather than installed, which
is its normal mode and keeps components editable.

The Phase 4 estimate (8–10 h) assumes this stack. The click-a-claim-to-highlight
interaction is the single most demo-critical piece of UI and should be built first within
that phase, not last.

**Rejected.** Vite + React SPA (loses SSR and the shared-route story; marginal gain at this
size). Plain React with no component library (Phase 4 has no budget for building a design
system from scratch).

**Amendment (Phase 4, 2026-08-10): shipped with Tailwind, without shadcn/ui or TanStack
Query.** Tailwind is in and is what the UI is built on. The other two were not added:

- **shadcn/ui** — the app needs four primitives (card, badge, button, file input). Vendoring
  a component library to obtain four elements adds a directory of code nobody edits.
- **TanStack Query** — there are two pages and three reads. The polling-plus-SSE hook is
  ~30 lines and already models exactly the "SSE is the fast path, polling is the guarantee"
  behaviour `docs/Jobs.md` requires. A cache layer would obscure that, not simplify it.

This follows `.cursor/rules/architecture.mdc`: avoid abstractions until there is a
measurable need. Both become worth adding when the UI grows past a handful of screens —
revisit at Phase 5 or the first real feature after it. Recorded here rather than left as a
silent divergence between the ADR and the code.

---

## ADR-015: Evidence quality metric

**Status:** Accepted

**Context.** Evidence accuracy is the product's differentiator, yet `evals/` contained five
empty directories with no rubric, no metric definitions, and no ground truth. The
`sample-data/expected-output/` files are generated by `scripts/seed.ts` from the same
stubs the system produces, so the eval loop was grading the system against its own output.
A wedge that cannot be measured cannot be defended.

**Decision.** Three metrics, defined in `docs/Evals.md`, measured against hand-authored
golden files:

| Metric | Definition | Gate |
|--------|------------|------|
| Claim precision | Shipped claims whose quote genuinely supports them | ≥ 0.95 |
| Hallucination rate | Shipped claims with no basis in the transcript | 0 |
| Claim recall | Golden claims the system found | ≥ 0.60 |

Precision and hallucination rate are **release gates**. Recall is **tracked, not gated** —
a strict evidence gate trades recall for precision by design (ADR-002), and gating recall
would create pressure to loosen the thing the product is built on.

Ground truth is hand-authored, never generated. A golden file carries both positive cases
(claims that must be found) and **negative cases** — plausible statements that were never
made and must never appear.

**Consequences.** Phase 3 does not exit until one golden file passes. Negative cases make
hallucination directly falsifiable rather than a matter of reading output and feeling
reassured. Cost: authoring a golden file is genuinely slow, perhaps 60–90 minutes per call,
which is why one is required rather than five.

**Rejected.** LLM-as-judge scoring (circular — a model grading a model on whether a quote
is real, when the deterministic matcher already answers that exactly). Generated expected
outputs (grades the system against itself, the failure being corrected here). Gating recall
(creates pressure to weaken the evidence gate).

---

## ADR-016: Recorded extraction for the offline demo

**Status:** Accepted

**Context.** ADR-012 made a pre-existing transcript a first-class entry point, which removed
STT from the demo's critical path. It did not remove the model: a sample call still needed
`LLM_BASE_URL` and `LLM_API_KEY`, and without them the job ended `llm_not_configured` with a
transcript and no notes. So the ship-checklist promise "sample data included, demo needs zero
setup" was false, and `docs/Demo.md`'s recovery for "the LLM provider is down" — show a
pre-run call — depended on the provider it was recovering from.

**Decision.** Extend fixture mode from speech to extraction. Each sample call has a recorded
extraction in `sample-data/extraction/`, replayed when no model is configured.

Four constraints make this a demo rather than a slideshow:

1. **Replay enters at the same seam as the model.** `ExtractionSource` is implemented by both
   the live orchestrator and the replay, and `NotesService` cannot tell which it holds. The
   evidence gate, section-drop accounting, and exit-status resolution all still run.
2. **Recordings hold the model's raw pre-gate output**, so a claim the gate rejects live is
   rejected on replay too. Recording post-gate results would report `shipped` where the real
   product reports `partial`, quietly deleting the beat the demo exists to show.
3. **Stage 2 is recorded from survivors only**, as the harness feeds it (ADR-013), so a
   rejected claim cannot reappear in a recorded summary.
4. **Fixture jobs only.** Uploaded or URL-sourced audio has no recording and still fails
   honestly. Serving one call's notes for another call's audio is the worst bug this codebase
   could ship, and the guard against it is a source check, not a naming convention.

Recordings are captured by `pnpm record` from a live model, never hand-authored, and each
carries the model and date it came from. `notes.metadata.llmModel` reads `replay:<fixture>`
and `tokensUsed` is 0, so no export can imply a live model produced them.

`sample-data/expected-output/` is deliberately **not** the replay source. Those files are
generated scaffolding — five copies of one placeholder quote that appears in no transcript —
so replaying them would produce empty notes and make the gate look broken (ADR-015 records
the same trap for evals).

**Consequences.** A fresh clone demos with no key, no network, and no account, which is also
the honest fallback when a provider is down mid-demo. Cost: recordings go stale when prompts
change, so `pnpm record` joins the release checklist alongside regenerating screenshots. The
staleness is visible rather than silent because `recordedFrom` is required.

**Rejected.** Hand-authored recordings (drifts into describing a product that grades better
than the one we ship). Replaying gated evidence (hides the gate). A global offline mode that
also covers uploads (mis-attribution risk with no upside). Exposing pre-gate candidates
through the API so the recorder could use HTTP (puts unproven claims in a client response,
which CLAUDE.md forbids outright).

---

## Deferred

Recorded so they are visibly open rather than accidentally missing. None block Phases 1–3.

| Topic | Why deferred | Needed by |
|-------|--------------|-----------|
| Authentication and multi-tenancy | MVP is single-tenant self-host | Before any hosted deployment |
| PII, retention, deletion, consent | No production data yet | Before real customer calls touch it |
| Share-link hardening (TTL enforcement, revocation, rate limits, `noindex`) | Phase 5; unguessable token is the Phase 5 minimum | Phase 5 |
| Observability spec (metrics, traces, correlation IDs) | Logging is sufficient at demo scale | Post-demo |
| Golden set beyond the first file; per-section thresholds; CI gate enforcement | Metrics and gates are decided (ADR-015); coverage breadth is a time question | Post-demo |
| Long-transcript chunking strategy | Sample calls are short | Before a 2-hour upload is supported |
| Prisma 7 upgrade (`prisma.config.ts` + driver adapter) | Version 6 works and matches all documentation; see ADR-005 amendment | Post-demo |
