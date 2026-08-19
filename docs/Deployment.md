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
