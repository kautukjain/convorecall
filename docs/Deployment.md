# Deployment

## Local

```bash
pnpm install
pnpm setup   # writes .env, starts Postgres on 5433, applies migrations
pnpm seed    # transcript fixtures
pnpm dev
```

Requires Node ≥ 20, pnpm 9, and Docker.

`pnpm dev` runs the API as a single watched process through SWC, which emits the decorator
metadata Nest relies on. Production still compiles with `tsc` (`pnpm build` → `pnpm start`),
so the type checker remains the gate on what ships — SWC only transpiles. Postgres binds host port **5433** because 5432 is
usually taken by a local install, and connecting to the wrong server produces a `P1010`
that points nowhere near the cause.

## Configuration

Two independent model capabilities (ADR-003). They are not the same provider.

| Capability | Keys | Notes |
|------------|------|-------|
| Speech-to-text | `PYAI_BASE_URL`, `PYAI_API_KEY`, `PYAI_STT_MODEL` | `https://api.pyai.com/v1`, model `pyai-hear` |
| Extraction | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | Any OpenAI-compatible `/chat/completions` |

PyAI serves speech, not chat completions — there is no `/v1/chat/completions` on it. The
extraction endpoint has to be something else. Verified working against OpenRouter; any
compatible provider is a config change, not a code change.

Every key is validated at startup and the process refuses to boot on a malformed value.

### Sandbox key for speech-to-text

PyAI mints a free sandbox key with no account, no email, and no card:

```bash
curl -X POST https://api.pyai.com/v1/sandbox/keys \
  -H 'content-type: application/json' \
  -d '{"label":"opengong-lite"}'
```

The endpoint requires no authentication. It is rate limited **per network**, and returns
`429 sandbox_limit_reached` once that network's quota is used — in which case use an
existing key or create an account.

`pnpm setup` now does this for you when `PYAI_API_KEY` is empty. The success payload was
observed directly on 2026-08-13, which is what made wiring it safe:

```json
{ "object": "sandbox.key", "api_key": "pyai_test_…", "key_id": "key_…",
  "environment": "test", "scopes": ["hear:transcribe", "…"],
  "expires_at": 1787219269113, "base_url": "https://api.pyai.com/v1" }
```

`201` on success. `api_key` is the only field the parser depends on; anything else missing is
reported, not fatal. **Sandbox keys expire after seven days** — `pnpm setup` prints the date,
and re-running it after expiry mints a fresh one.

Two guarantees in `scripts/sandbox-key.ts`, both covered by tests:

- An existing `PYAI_API_KEY` is never overwritten. Clobbering a working credential during
  setup is a worse failure than not minting one.
- A failed mint is never fatal. Setup prints the `curl` above and carries on — the five sample
  calls need no key at all, since they ship written transcripts.

The key is written to `.env` and never printed, not even truncated.

### The extraction endpoint cannot be minted

Speech and text are provisioned differently, and `pnpm setup` reflects that rather than papering
over it.

PyAI mints a sandbox key with no account, so setup finishes speech unattended. **No
OpenAI-compatible text provider does the same** — OpenRouter, OpenAI and the rest all require a
signed-up account before a key exists, so there is nothing a script can call. That is a property
of the providers, not a gap in the setup script.

It does not block a fresh clone, because extraction is not needed to see the product: the five
sample calls replay a recorded extraction through the real evidence gate (ADR-016). A key is
needed only to analyse audio of your own.

Setup therefore does three things, in order:

1. If `LLM_BASE_URL` and `LLM_API_KEY` are already set, it reports the host and model and changes
   nothing.
2. Otherwise it probes for a local OpenAI-compatible runner — Ollama on `:11434`, LM Studio on
   `:1234` — and points extraction at it if one is serving a model. **This is the only keyless
   path to real extraction**, and it needs no account, no card, and no network.
3. Otherwise it says extraction is unconfigured, says the sample calls do not need it, and prints
   what to set.

A runner that is up but holds no model is not treated as a hit; it could not serve extraction.

**Verified end to end against a local OpenAI-compatible endpoint** (2026-08-13): with
`LLM_BASE_URL=http://localhost:11434/v1`, `LLM_API_KEY=local`, the harness shipped notes whose
quotes resolved to real segments through the ordinary evidence gate, and `notes.metadata.llmModel`
recorded the local model id. No part of the pipeline needs a hosted provider.

One caveat that is about model quality rather than configuration. The evidence gate accepts a claim
only if its quote resolves at `EVIDENCE_MATCH_THRESHOLD` (0.85), and smaller local models paraphrase
more than large ones. A weaker model therefore tends to lose claims to the gate rather than emit
wrong ones — sparse notes, not false notes, which is the failure direction ADR-002 chose on purpose.
If a local model produces empty sections, that is the gate working; reach for a stronger model rather
than a lower threshold, because the threshold is the product.

## Production

Nothing here is ready for a shared deployment. There is no authentication, no retention
policy, and no tenancy — see the deferred register in `docs/Decisions.md`. Close those
before exposing it to anyone but yourself.

With that said, the shape it wants:

| Piece | Suggested |
|-------|-----------|
| Web | Vercel, or any Node host |
| API + worker | Fly.io, Railway, Render — one process runs both |
| Database | Managed Postgres |
| Audio | Object storage; `STORAGE_DIR` is local-disk only |

Run migrations explicitly on deploy with `prisma migrate deploy`, never automatically at
boot — a boot that mutates a schema is how two instances corrupt each other during a
rolling restart.

### Splitting the worker out

`WORKER_ENABLED=false` runs an API instance that serves but processes nothing. Run one
instance with the worker off and another with it on, and the split is done — the queue is
already a table and the claim is already atomic (ADR-008). No redesign.

### Scaling notes

- Uploads are buffered in memory so the bytes can be sniffed before anything is persisted.
  Fine at demo and self-host scale; a streaming store is the swap under concurrent large
  uploads.
- The worker polls; `WORKER_CONCURRENCY` defaults to 2 per instance.
- Rate limits are in-memory per instance. Behind more than one instance they become
  per-instance, and want a shared store.
