# Project state

> Living document. Update at the end of every phase.

## Status

| Field | Value |
|-------|-------|
| Phase | Release-ready (unreleased) |
| Status | All phases complete. Polish and release docs done. **Nothing is committed.** |
| Last updated | 2026-08-13 |
| Blockers | Four, audited against the ship checklist — see `docs/Ship-Blockers.md`. Extraction is live via OpenRouter (`google/gemma-4-31b-it`); the blockers are release and demo-setup gaps, not extraction. |

## Done

- [x] Repository layout and kit scaffolding
- [x] Repository structure finalization (infra, evals, benchmarks, examples, cursor commands)
- [x] Planning phase: 15 ADRs, normative specs for harness, jobs, evidence, schema, API, evals
- [x] Phase 0: NestJS API, Next.js web, Postgres + Prisma migration, real lint/test/build gate
- [x] Phase 1: upload / url / fixture ingest, magic-byte validation, Call + Job in one transaction
- [x] Phase 2: STT + diarization, worker loop, SSE progress, transcript endpoint
- [x] Phase 3: extraction + evidence gates, live end to end; eval runner reports real numbers
- [x] Phase 4: notes UI, click-to-highlight, progress and empty/error/partial states
- [x] Phase 5: Markdown + JSON export, share links, rate limiting
- [x] Polish + demo + release docs (screenshots, changelog, deployment, roadmap, favicon)

## Current focus

Phases 0 and 1 are done and verified against a live database. Phase 2 (transcription) is
next, and it is gated on the provider spike.

### What Phase 5 delivered

| Piece | State |
|-------|-------|
| `GET /calls/:id/export.md` | text/markdown attachment; every claim carries quote, speaker, timestamp |
| `GET /calls/:id/export.json` | Notes payload verbatim as a download |
| `POST /calls/:id/share` | 32 CSPRNG bytes, base64url (43 chars) — never sequential, never derived |
| `GET /share/:token` | Public, read-only, `X-Robots-Tag: noindex`, `Cache-Control: no-store` |
| Share page | Server-rendered, screenshot-friendly, friendly error for a dead link |
| Rate limiting | The limits `docs/API.md` promised, now real |

**Verified live:** exports download with correct headers and inline receipts; a share link
opens read-only notes; `tokensUsed`, `llmModel`, `sttModel`, `promptVersion` and
`callId` are all confirmed **absent** from the public payload; share reads measured at
exactly 60 × 200 then 10 × 429 against the documented 60/min.

**Bug caught by exercising it, not by reading it:** declaring four named throttlers in
`ThrottlerModule.forRoot` applies *all* of them to *every* route, so the whole API was
capped at the tightest limit — 10 requests/hour. A `Retry-After-ingest` header on a plain
GET gave it away. One named throttler is declared globally now, with tighter limits
attached to their own routes. This would have killed the demo.

### What Phase 4 delivered

| Piece | State |
|-------|-------|
| Start page | Upload (mp3/wav/m4a/webm) or run a sample call; unwritten fixtures disabled with a reason |
| Progress | SSE as the fast path, 3s polling as the guarantee; stage-specific copy |
| Notes page | Summary, intent, objections, next steps, follow-up email |
| Evidence card | Claim + **the quote, always visible** + speaker + timestamp; low-confidence marked, never hidden |
| Click to highlight | Selecting a claim scrolls its transcript span into view and pulses it |
| Exit states | `partial` styled as ordinary, `deadline` as a budget stop, only `failed` alarming |
| Dropped claims | "N claims removed — not verifiable" shown in the header, not buried |
| CORS | Named origin only, never `*` |

Verified live: fixture -> `shipped`, and **5/5 claims point at a segment the transcript
endpoint actually returns**, so the click-to-highlight interaction has valid data on both
sides rather than only appearing to.

### What Phase 3 delivered

| Piece | State |
|-------|-------|
| Prompts | Versioned v1: 3 evidenced extractors, 2 derived synthesizers, 1 repair |
| LLM client | OpenAI-compatible, transport retry 3x with jittered backoff, timeout, token accounting |
| Schema gate | Zod parse, exactly one repair attempt, then the section is dropped |
| Evidence gate | Quote resolved against the transcript; position and speaker derived, never trusted |
| Two-stage pipeline | Evidenced sections gated **before** derived sections are synthesized (ADR-013) |
| Budget governor | Checked before each call, not after; exhaustion yields `deadline`, not `failed` |
| Exit status | Pure ordered resolution (ADR-011), exhaustively tested |
| Eval runner | `pnpm eval` scores the gate against golden files; exits non-zero on failure |
| Notes | Persisted with metadata in one transaction with the terminal state; `GET /calls/:id/notes` |

**Verified by test, not assertion:** all 5 positive golden cases keep their exact segment;
all 6 negative cases drop (hallucination rate 0); a dropped claim is provably absent from
what the derived synthesizer is handed; budget exhaustion yields `deadline` with nothing
spent; total-failure yields `failed`.

**Verified live:** with no LLM configured, a job stops at `FAILED / llm_not_configured`
and `GET /notes` returns 409 — it does not report empty notes as a result.

### What Phase 2 delivered

| Area | State |
|------|-------|
| Worker | In-process, atomic `SKIP LOCKED` claim, heartbeat, stale reclaim, deadline sweep |
| STT | PyAI async job API with `diarize=true`, polled; positional speaker labels |
| Fixture path | ADR-012 verified: 35 segments, Rep/Prospect preserved |
| Transcript | `GET /api/v1/calls/:id/transcript`; 409 before it exists |
| SSE | `GET /api/v1/calls/:id/events`, persisted event log, `Last-Event-ID` replay verified |

End to end with real audio: upload -> queued -> transcribing -> diarized segments persisted
-> `GET /transcript` returns speaker-labelled, timestamped text. Jobs currently end at
`partial` with all five sections dropped, because extraction is Phase 3 — the worker says
so explicitly rather than pretending to have notes.

### Findings from spike 2a

- **The sync endpoint is unusable for this product.** `POST /v1/audio/transcriptions`
  returns only `{text, duration}` — no segments, timestamps, or speakers, under any
  parameter combination. Diarization lives on the async job API. Recorded in ADR-003.
- **Config was wrong in two places**: the base URL needs `/v1`, and the model is
  `pyai-hear` not `hear`. Both would have failed at the first real call.
- **Real transcripts are lowercase and unpunctuated.** Normalization is therefore
  load-bearing, not cosmetic.
- **A real matcher bug, findable only with real data**: STT writes `buy in`, a model
  quoting it writes `buy-in`, and the claim was dropped. Intra-word hyphens now split on
  both sides. The Phase 0 contraction folding paid off unchanged — the provider expands
  contractions itself, so `We're not sure` resolves at 1.00 against `we are not sure`.

### What Phase 1 delivered

| Endpoint | Verified behaviour |
|----------|--------------------|
| `POST /api/v1/calls` (upload) | 202 + id; bytes sniffed, stored under a generated UUID key |
| `POST /api/v1/calls` (url) | 202 + id, `source: url` |
| `POST /api/v1/calls` (fixture) | 202 + id, `source: fixture`; unknown name → 400 |
| `POST /api/v1/calls` (bad file) | PNG named `.mp3` → 415 problem+json, nothing stored |
| `POST /api/v1/calls` (empty) | 400 problem+json |
| `GET /api/v1/calls/:id` | Full state + budget payload |
| `GET /api/v1/calls/:missing` | 404 problem+json |

Invariants checked directly in Postgres after the run: **3 calls, 3 jobs, zero orphans.**
Upload stored outside the web root under a generated key, with `originalName` retained for
display only. Rejected uploads leave no file behind.

### Findings from Phase 1

- **`emitDecoratorMetadata` broke DI under tsx.** esbuild does not implement it, so every
  Nest constructor parameter arrived `undefined` and the app could not boot — while 46
  unit tests stayed green, because they construct classes by hand and never exercise
  injection. `apps/api` now compiles with `tsc` for both dev and prod, so the transform is
  identical in both, and `tsx` has been removed from that package entirely.
- **A DI wiring test was added** (`apps/api/src/app.module.spec.ts`) and it does catch
  missing providers — but it does *not* reproduce the bug above, because Vitest 4's
  transform emits decorator metadata even when tsx's does not. Honest limitation: only
  booting the compiled app exercises that path. Removing tsx is the actual fix.
- **`duration_exceeded` is deferred to Phase 2**, where duration first exists. Recorded in
  `docs/API.md` rather than left as a silent gap.

### What Phase 0 delivered

| Area | State |
|------|-------|
| API | NestJS 11, `GET /api/v1/health` → `{ok:true}`; `/health` correctly 404s |
| Config | Zod-validated env, fails fast on malformed values (`apps/api/src/config/env.ts`) |
| Web | Next.js 16 App Router shell, builds and serves |
| Database | Postgres 16 via compose on **port 5433**; Prisma 6; `init` migration applied, 6 tables |
| Evidence matcher | Normalization, contraction folding, exact + fuzzy matching, span resolution |
| Tests | 29 passing, including all 11 golden-file cases |
| Gate | `lint`, `typecheck`, `test`, `build` all real and green; lockfile committed |

`apps/api/src/index.ts` and `apps/web/src/server.ts` (the `node:http` placeholders) are
deleted. All `echo` script stubs are gone — no package fakes a passing check any more.

### Divergences from plan, recorded

- **Prisma pinned to 6**, not 7 (ADR-005 amendment). Prisma 7 requires `prisma.config.ts`
  plus a driver adapter and `@prisma/config` does not resolve under this pnpm layout.
- **Postgres on host port 5433**, not 5432 — a local Postgres already held 5432 and Prisma
  reported the collision as `P1010 denied access`, which points nowhere near the cause.
- **`normalizeForMatch` folds contractions.** Writing the matcher disproved a worked
  example in `docs/Evidence-System.md`: token similarity scores `we're` against `we are` at
  0.67, well under the 0.85 threshold, not the 0.93 the doc claimed. Canonicalizing
  contractions on both sides makes it an exact match instead. `docs/Evidence-System.md`
  has been corrected, and every worked example there is now asserted as a test.

## Estimates

Honest working hours, not elapsed time. Phase 3 is the product; everything else serves it.

| Phase | Scope | Est. |
|-------|-------|------|
| 0 | Nest + Prisma + Postgres compose, lockfile, real lint/test, CI green | 6–8 h |
| 1 | Upload/URL/fixture ingest, validation, storage, call + job rows | 5–6 h |
| 2 | STT adapter, diarization normalization, fixture path, SSE progress | 6–8 h |
| 2a | **Provider spike** — STT + diarization + timestamp granularity | 2 h |
| 3 | Prompts, schemas, both gates, retry classes, evidence matcher, exit status | 10–12 h |
| 3a | Eval runner against the golden file; Phase 3 exits on it passing (ADR-015) | 3 h |
| 4 | Notes UI, click-to-highlight, empty/error/partial states | 8–10 h |
| 5 | Markdown + JSON export, share link | 4–5 h |
| — | Polish, demo rehearsal, release | 6 h |
| | **Total** | **50–60 h** |

Read that total before committing to a demo date. This is not a one-day build, and the
Nest choice front-loads roughly 3 h of it into Phase 0 before anything is demoable.

## Cut list

Pre-agreed, ranked. Cut from the top when behind. Deciding this now is the point — nobody
makes good scope calls at 6pm the night before.

| # | Cut | Costs |
|---|-----|-------|
| 1 | Motion, animation, logo polish | Taste points only |
| 2 | Ship 2 sample calls instead of 5 | Demo variety |
| 3 | JSON export (keep Markdown) | Little — Markdown demos better |
| 4 | URL ingest (keep upload + fixture) | One README bullet |
| 5 | Share link (keep export) | The second-screen demo beat |
| 6 | **Live STT — demo from fixtures only** | The upload moment; ADR-012 makes this survivable |
| 7 | Web UI beyond the notes page | Falls back to API + export |

**Never cut**, in any scenario: the evidence gate, the schema gate, named exit statuses,
and showing `droppedClaims`. Those are the product. A demo without them is a demo of
something else.

## Risks

| # | Risk | Trigger | Response |
|---|------|---------|----------|
| 1 | ~~PyAI STT/diarization unverified~~ | — | **Closed by spike 2a.** Diarization and timestamps confirmed working via the async job API; see ADR-003 |
| 2 | ~~Sample calls thin~~ | — | **Closed.** All 5 hand-authored, rewritten as speech; 2, 3 and 4-speaker variants |
| 14 | ~~`pnpm dev` restarted mid-request~~ | — | **Fixed.** The dev script ran `tsc --watch` writing `dist/` while `node --watch` watched `dist/` — every recompile restarted the server, killing in-flight uploads, and overlapping restarts collided on port 3001 as "Failed running dist/main.js". Now one process: `node --watch --import @swc-node/register/esm-register src/main.ts`. SWC emits the decorator metadata Nest needs, which is why tsx could not be used here |
| 13 | **Provider ceiling is size, not just duration** | 52.9 MB wav → hard 413; `UPLOAD_MAX_BYTES` now 12 MB | Real fixes, both in `docs/Roadmap.md`: transcode to mp3 before upload, and pass `audio_url` for link ingest so the provider fetches directly and no upload limit applies |
| 12 | **STT fails above ~10 minutes of audio** | Measured: 2 min ok (8s), 10 min ok (81s), 20 min → 503 upstream reset, 32 min → 500 | `UPLOAD_MAX_DURATION_MS` still says 2 h, which is a promise the provider cannot keep. Real fix is audio chunking: split >10 min, transcribe each, stitch with time offsets |
| 11 | **4 of 5 audio files are stale** — rendered with macOS `say`, which reads flatly | Now | `objection-call` (the demo call) is neural and verified. The rest need `pnpm --filter @convorecall/generators start <call>` once the key's daily cap resets at 00:00 UTC — roughly 45 requests per day, and a call costs one per segment |
| 3 | ~~Phase 0 overruns on Nest + Prisma~~ | — | **Closed.** Nest + Prisma landed well inside estimate; ADR-005 stands |
| 4 | Evidence gate too strict → empty notes | <50% of claims survive on the first real transcript | Tune `EVIDENCE_MATCH_THRESHOLD`; ship low-confidence marked, not dropped |
| 5 | ~~No lockfile → CI red~~ | — | **Closed in Phase 0.** Lockfile generated; lint/typecheck/test/build all real and green |
| 6 | ~~Diarization mislabels speakers~~ | — | **Closed by spike 2a.** 2 speakers separated correctly at the true boundary. Positional-label fallback retained and tested |
| 7 | Token budget exceeded on long calls | >120k tokens on a 30-min call | Chunking is deferred — cap demo calls at ~15 min |
| 8 | Total estimate exceeds available time | Behind by end of day 2 | Invoke the cut list from the top |
| 9 | ~~LLM unavailable for extraction~~ | — | **Closed.** OpenRouter + `google/gemma-4-31b-it`. Provider-agnostic: three providers were swapped by config alone, no code change |

| 10 | **Extraction quality varies run to run** | Recall 2/3–3/3 across 4 runs at temp 0.2 | A single eval run is not a measurement. Average several, or pin `seed` |

Risk 1 and risk 2 compound: if both hold, the demo is fixture-only and that decision should
be made early enough to rehearse it, not discovered on the day.

## Repository organization

| Area | Path | Notes |
|------|------|-------|
| Apps | `apps/web`, `apps/api` | Feature-sliced web; modular Nest API. `modules/calls` owns ingest |
| Shared packages | `packages/{ui,config,shared,validators,prompts,types}` | Workspace libraries |
| Examples | `packages/examples/{api,emails,prompts,exports}` | Non-production fixtures |
| Docs | `docs/` | **Normative** — contracts, schemas, harness |
| Sample data | `sample-data/` | Demo audio + transcripts + expected outputs |
| Infra | `infra/{docker,compose,nginx,terraform}` | Postgres compose; deploy placeholders |
| Evals | `evals/{summary,transcript,evidence,objections,followup}` | Quality fixtures |
| Benchmarks | `benchmarks/{latency,accuracy,cost,memory}` | Perf/cost harnesses |
| Agent kit | `.cursor/{rules,prompts,commands,skills}` | Style rules only (ADR-004) |

Adding a top-level directory or workspace package is an architectural change: record it
here first.

## Decisions

Full records with context, consequences, and rejected alternatives: `docs/Decisions.md`.

| ADR | Decision |
|-----|----------|
| 001 | pnpm + Turborepo monorepo |
| 002 | Evidence-first: no receipt, no ship |
| 003 | OpenAI-compatible client; models are config |
| 004 | `docs/` normative, `.cursor/rules/` style-only |
| 005 | NestJS + Prisma over Postgres |
| 006 | `shipped` · `partial` · `failed` · `deadline` |
| 007 | Two retry classes: transport (3) and schema repair (1) |
| 008 | `jobs` table + in-process worker + SSE |
| 009 | Model supplies claim + quote; matcher derives position |
| 010 | `/api/v1`, unwrapped bodies, problem+json errors |
| 011 | Exit thresholds, first-match-wins |
| 012 | Fixture mode is a first-class ingest path |
| 013 | Evidenced vs derived sections |
| 014 | Web stack: Next.js, Tailwind, shadcn/ui, TanStack Query |
| 015 | Evidence quality metric; precision and hallucination gate, recall tracked |

Open and deliberately deferred: auth, PII/retention, share hardening, observability,
golden set size beyond the first file, long-transcript chunking. See the deferred register
in `docs/Decisions.md`.

## Ground truth

`sample-data/transcripts/objection-call.json` is hand-authored and is the ground truth for
`evals/objections/objection-call.golden.json` (ADR-015). `scripts/seed.ts` only writes
files that do not exist, so it will not overwrite either.

Everything else under `sample-data/expected-output/` is generated scaffolding, not ground
truth, and must not be used to grade quality.

## Next actions

1. **`git add -A && git commit`.** Six phases, 88 tests, three sample calls and 2,000+
   lines of docs exist only in this working tree. Everything below is smaller than this.
2. Tag `v0.1.0` once committed — `CHANGELOG.md` is written and dated for it.
3. Rehearse `docs/Demo.md` end to end on the machine you will demo from, with the
   provider you will use. Extraction varies run to run; do not promise a claim count.
4. Before anyone else can reach it: authentication, retention policy, share hardening.
   These are listed in `docs/Roadmap.md` under "before this is safe to host" and are the
   difference between working and safe.
