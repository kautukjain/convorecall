# Demo script (≤ 90s)

Rehearsed against the real product. Timings are from actual runs, not estimates.

## Before you start

```bash
pnpm setup && pnpm seed
pnpm --filter @convorecall/web build     # shoot and demo from a production build
pnpm dev
```

- Two browser tabs: `localhost:3000`, and a second screen with a share link already open.
- Pre-run `enterprise-call` once so the notes are warm — extraction takes ~15s and dead
  air is the enemy.
- Confirm `pnpm eval` passes. If the gate is red, do not demo the gate.

## The script

**1. Hook — 10s**

> "Gong is about fourteen hundred a seat. The job it does is: what happened, what they
> pushed back on, what to do next. Here's that job, MIT licensed."

**2. Run a call — 15s**

Click **Multi-stakeholder**. While it runs:

> "Four people on this call — a VP of sales, security, procurement. Watch who each
> objection gets attributed to."

**3. The notes — 30s**

> "Four objections. Adoption risk from the VP. The data processing agreement from
> security. Contract term from procurement."

Then the moment that matters — click a claim.

> "Every line has the quote next to it. Click it and you land on the sentence. You are
> never asked to take its word for anything."

**4. The gate — 20s**

This is the beat most demos skip. Do not skip it.

> "The interesting part is what's *not* here. Anything the system couldn't match to
> something actually said gets dropped, and it tells you how many. Most tools optimise
> for looking complete. This one would rather show you four claims you can check than
> eight you can't."

**5. Export and share — 15s**

Both are buttons in the notes header now. Hit **Markdown** — quotes and timestamps are inline,
so the receipts survive leaving the app. Then **Share link**, and open it on the second screen.

> "Read-only, no login, not indexed. MIT. Clone it."

## If something breaks

| Failure | Recovery |
|---------|----------|
| Extraction is slow or errors | Switch to the pre-run call — it is already in the list |
| The LLM provider is down | Blank `LLM_API_KEY` and restart the API. Sample calls replay a recorded extraction (ADR-016) and still run the real gate. `Verified` will read `replay:<call>` in the JSON export — say so rather than hiding it |
| Postgres is not up | `pnpm db:up`, wait for healthy, retry |
| Everything is on fire | The screenshots in `docs/Screenshots.md` are real output |

Fixture mode is the fallback that makes this survivable: no audio upload, no STT, and — with
the extraction recorded — no network at all (ADR-012, ADR-016). Sample calls run on a laptop
with no key and no wifi.

## Notes on honesty

Extraction is not deterministic — the same call has produced between three and seven
claims across runs. Rehearse the call you plan to demo, on the day, with the provider you
plan to use. Do not promise a specific number of objections.
