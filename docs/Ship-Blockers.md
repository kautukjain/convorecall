# Ship blockers

Audited 2026-08-13 against the hackathon ship checklist. Every row below was verified
against the code or a live run, not inferred from the docs — where a doc and the code
disagreed, the code won and that disagreement is recorded as the finding.

Ordered by what stops a demo or a release, not by effort.

| # | Blocker | Fails | Effort | Status |
|---|---------|-------|--------|--------|
| 1 | Nothing is committed | MIT license, public repo | minutes | prepared, parked at the owner's call |
| 2 | Sample-call demo needs an LLM key | Demo needs zero setup | ~2 h | **closed 2026-08-13** |
| 3 | Sandbox key does not mint itself | Sandbox key mints itself on first run | ~30 min | **closed 2026-08-13** |
| 4 | Export and share have no UI | Export to Markdown, JSON or a share link | ~1 h | **closed 2026-08-13** |

Blockers 2, 3 and 4 are closed. Blocker 1 is prepared and waiting on the owner's decision to
publish. Two partials are tracked at the bottom, and two checklist items that were failing —
"Transcript with speaker names" and the follow-up email's invented names — are recorded under
[Closed](#closed).

---

## 1. Nothing is committed

**The one binary item on the checklist, and it is unmet.**

```
$ git rev-list --all --count
0
$ git ls-files | wc -l
0
$ git remote -v
(no output)
```

Six phases, 122 tests, five sample calls, and 2,000+ lines of docs exist only in this
working tree. `LICENSE` is MIT, so the licence half is satisfied; "public repo" is not,
and an uncommitted tree is one `rm -rf` from being nothing at all.

`PROJECT_STATE.md` already says "Nothing is committed" in its Status row and lists the
commit as Next action 1 — while its **Blockers row says "None"**. That row is wrong and is
part of this finding.

**Fix.** Commit, push, tag. `CHANGELOG.md` is already written and dated for `v0.1.0`.
Confirm `.gitignore` covers `.env`, `.data/`, `node_modules/`, `.next/`, `dist/`, and the
loose `*.mp3` / `*.wav` files currently sitting in the repo root before the first `git add`.

---

## 2. The sample-call demo is not zero-setup

**Checklist says "Sample data included, demo needs zero setup". Sample data: yes. Zero
setup: no.**

A fixture call skips speech-to-text — the transcript ships written — but extraction still
calls a live model. With no key, `apps/api/src/modules/jobs/worker.service.ts:185` fails
the job honestly:

```ts
if (!this.orchestrator.isConfigured()) {
  await this.jobs.transition(job.id, "FAILED", {
    failureReason: "llm_not_configured",
    ...
```

That is the correct behaviour for a missing key — it is not the correct behaviour for a
demo that claims to need no setup. There is no offline extractor: a search for
`stub|fake|offline` under `apps/api/src` returns nothing.

**Why it matters beyond the checklist.** `docs/Demo.md` lists "The LLM provider is down"
in its recovery table, and the recovery is "show the export and share pages from the
pre-run call" — which needs a pre-run call, which needs a working provider. The fallback
has a dependency on the thing it is a fallback for.

**Fixed 2026-08-13** — ADR-016. A recorded extraction per sample call in
`sample-data/extraction/`, replayed when no model is configured.

The original fix proposed here — replay `sample-data/expected-output/` — **was wrong, and is
recorded rather than quietly edited out.** All five of those files are identical placeholder
scaffolding: the same `"worried about price"` quote, `intent` as a bare string instead of
`Evidence`. That text appears in no transcript, so the gate would have dropped every claim
and the offline demo would have rendered empty notes while looking like a gate bug.
`PROJECT_STATE.md` warned about exactly this and the warning was right.

What shipped instead:

- `ExtractionSource` is the seam. The live orchestrator and the replay both implement it, and
  `NotesService` never learns which one it has — so the evidence gate, the section-drop
  accounting, and the exit status all still run on replayed claims.
- Recordings hold the model's **raw, pre-gate** output, captured by `pnpm record` from a live
  model. Recording post-gate results would report `shipped` where the product reports
  `partial` and would silently delete the drop-count beat.
- Fixture jobs only. Uploaded and URL-sourced audio have no recording and still fail with
  `llm_not_configured`.
- `notes.metadata.llmModel` reads `replay:<fixture>` and `tokensUsed` is 0.

Verified end to end on a keyless server against its own database: `enterprise-call` shipped
with 7 objections and 4 next steps, `llmModel: replay:enterprise-call`, 0 tokens, real
segment ids resolved against that call's transcript, and intent attributed to Sarah. With the
recording removed, the same call failed honestly as `llm_not_configured`. Five tests cover the
seam, including one that fails if the gate is ever bypassed.

Known limit: a recording can only drop claims that the recorded run actually produced
unverifiably. The current set happens to have zero rejects, so the offline demo reports
`shipped` on all five. Re-recording after a prompt change may reintroduce drops. Do not
hand-pick a recording for the drop count it produces — that is authoring results.

---

## 3. The sandbox key does not mint itself

**Checklist says "Sandbox key mints itself on first run". It is a curl in a document.**

`docs/Deployment.md:40` documents the mint:

```bash
curl -X POST https://api.pyai.com/v1/sandbox/keys ...
```

`scripts/setup.ts:28` (`ensureEnv`) writes `.env` from `.env.example` and never calls it,
so `PYAI_API_KEY=` stays empty. `.cursor/prompts/release.md:12` only claims the path is
*documented*, which is true and is a weaker promise than the checklist makes.

**Fixed 2026-08-13** — `scripts/sandbox-key.ts`, called from `pnpm setup`.

The doc's stated reason for not wiring it was sound: the success payload had never been seen,
and "parsing a response shape nobody has seen is how you break a fresh clone's first five
minutes". So the first step was to stop guessing — a live `POST` returned `201` with `api_key`,
`expires_at`, and ten scopes. The parser is written against that observed response, and
`docs/Deployment.md` now records the shape instead of the caveat.

Two guarantees, both tested:

- **An existing key is never overwritten.** Verified against a real `.env` containing a key:
  byte-identical afterwards by sha256, and the mint endpoint is not even called.
- **A failed mint is never fatal.** A `429` (the endpoint is rate limited per network), an
  offline machine, or a payload without `api_key` all leave `.env` untouched and print the
  `curl` to run by hand. Setup continues.

Verified end to end against the live endpoint with a throwaway `.env`: minted, written to the
right line, all 52 other lines preserved, and the second run was a no-op rather than a wasted
mint. 11 tests, including one asserting the key never appears in a log message.

Note for the checklist: **sandbox keys expire after seven days.** Setup prints the expiry date,
and re-running `pnpm setup` after it mints a fresh one. A demo more than a week after setup
needs a re-run — which is exactly the kind of thing that is invisible until it is not.

---

## 4. Export and share have no UI

**All three endpoints work. Nothing in the app calls them.**

| Endpoint | Where |
|----------|-------|
| `GET /calls/:id/export.md` | `apps/api/src/modules/export/export.controller.ts:17` |
| `GET /calls/:id/export.json` | `apps/api/src/modules/export/export.controller.ts:29` |
| `POST /calls/:id/share` | `apps/api/src/modules/share/share.controller.ts:15` |

The web app never references any of them. `apps/web/app/share/[token]/page.tsx` *renders* a
share token, but nothing mints one, so reaching that page requires a hand-pasted URL.

**Why it matters beyond the checklist.** `docs/Demo.md` beat 5 is "flash the Markdown
export, then the share link on the second screen". As built, that beat needs a terminal and
a copy-paste in front of an audience.

**Fixed 2026-08-13** — `apps/web/components/notes/ShareAndExport.tsx` in the notes header.

Exports are fetched rather than linked. The endpoints already set
`content-disposition: attachment`, so an anchor would have worked, but they are on another
origin where the `download` attribute is ignored and a failure would navigate the reader to a
raw problem+json page. Going through `fetch` keeps errors in the same shape as every other
call.

That surfaced a second defect: **CORS hides every non-simple response header from JavaScript**,
so `content-disposition` read as `null` and downloads landed as `call-<uuid>.md` instead of the
name the API had already sanitized. Fixed with `exposedHeaders: ["content-disposition"]` in
`apps/api/src/main.ts`.

Verified by driving the real buttons in a browser: both files written to disk as
`opengong-<call>.md` (2.2 KB, receipts inline) and `.json` (3.4 KB), and a minted link renders
the public page with `x-robots-tag: noindex, nofollow` on both the page and the API response.

On the hardening concern recorded above: the link is created with the API's existing default
and nothing about the deferred TTL/revocation work changed. What the UI adds is disclosure —
the URL is shown in full alongside "Public and read-only. Anyone with the link can read these
notes without signing in. It does not expire." A one-click copy with no statement of what was
just created is how an unhardened surface becomes an accident, so the link is displayed rather
than silently placed on the clipboard.

---

## Partials

These pass in substance but not in the letter of the checklist.

**Five-minute setup.** `pnpm install && pnpm setup && pnpm seed && pnpm dev` works and is
accurate in the README. Since blocker 2 closed, that path now reaches a *working demo* with no
key at all, so this is effectively met for the sample calls. Your own audio still needs two keys set
by hand, and blocker 3 closes half of that.

**Killer screenshot.** `README.md:14` embeds `assets/screenshots/02-notes.png` and it is
current as of 2026-08-13. `docs/Screenshots.md` requires regenerating after any UI change;
that instruction is easy to forget and there is no check that enforces it.

---

## Closed

**Transcript with speaker names** — closed 2026-08-13.

`SpeakerNamingService` and its evidence gate already existed and were wired through the
worker, but `SpeakerNamingService.needsNaming()` only fires when every label matches
`/^Speaker \d+$/`. Authored fixtures use role labels, so the naming path was dead on the
five sample calls — the only calls anyone demos.

Fixtures now propose names through an optional `speakerNames` array carrying the line that
proves each one, and those proposals go through the same gate as a model's: the quote must
resolve against the transcript and must contain the name. Verified live — `support-call`
reads `Support, Priya, Nadia`; `enterprise-call` reads `Rep, Sarah, Security, Procurement`,
because Ravi and Ruth are greeted in one breath and never tied to a seat. Guessing which of
them is Security would be the exact mis-attribution the evidence gate exists to prevent.
