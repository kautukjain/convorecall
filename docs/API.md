# API

Base URL: `http://localhost:3001` (dev). All endpoints under `/api/v1` (ADR-010).

Success responses return the resource unwrapped — HTTP status already carries success, so
there is no `{success, data}` envelope. Errors are RFC 9457 `application/problem+json`.

Normative (ADR-004).

---

## Interactive reference

`GET /api/v1/docs` — Swagger UI, generated from the running application.
`GET /api/v1/docs.json` — the OpenAPI document.

This file stays the normative contract (ADR-004); the generated spec is what the code
actually serves. A disagreement between them is a bug in one or the other, and
`scripts/` has no automation for it yet — compare paths before a release.

## Conventions

**Errors.**

```json
{
  "type": "https://convorecall.dev/problems/upload-too-large",
  "title": "Upload too large",
  "status": 413,
  "detail": "File exceeds the 100 MB limit.",
  "code": "upload_too_large"
}
```

`code` is the stable machine-readable field; `title` and `detail` are human-facing and may
change. Responses never contain stack traces, SQL, filesystem paths, provider errors, or
secrets. Operator detail goes to `Job.lastError` and the logs, never to the client.

| `code` | Status |
|--------|--------|
| `invalid_request` | 400 |
| `unsupported_media_type` | 415 |
| `upload_too_large` | 413 |
| `duration_exceeded` | 422 |
| `call_not_found` | 404 |
| `transcript_not_ready` | 409 |
| `notes_not_ready` | 409 |
| `share_not_found` | 404 |
| `share_expired` | 410 |
| `rate_limited` | 429 |
| `internal_error` | 500 |

**Timestamps** are ISO 8601 UTC. **Durations and offsets** are integer milliseconds.
**IDs** are UUIDs; share tokens are base64url.

---

## Health

### `GET /api/v1/health`

```json
{ "ok": true, "service": "convorecall-api", "version": "0.1.0" }
```

Liveness only. Does not touch the database or any provider, so it stays honest under
partial outage.

---

## Calls

### `POST /api/v1/calls`

Creates a call and its job (ADR-008). Returns immediately — analysis is asynchronous.

Three request forms:

| Form | Content-Type | Body |
|------|--------------|------|
| Upload | `multipart/form-data` | `file` |
| URL | `application/json` | `{ "url": "https://..." }` |
| Fixture | `application/json` | `{ "fixture": "objection-call" }` |

Fixture mode (ADR-012) is a first-class path, not a test affordance: it skips ingest and
STT and enters the pipeline at `extracting`.

**Validation** — enforced server-side, never from the filename:

- Accepted: `audio/mpeg`, `audio/wav`, `audio/mp4`, `audio/m4a`, `audio/webm`
- Content sniffed by magic bytes; extension and declared `Content-Type` are never trusted
- Max `UPLOAD_MAX_BYTES` (**12 MB**) → `upload_too_large`
- Max `UPLOAD_MAX_DURATION_MS` (2 h) → `duration_exceeded`
- Stored under a generated key outside the web root; `originalName` retained for display

> **The 12 MB ceiling is the transcription provider's, not ours.** Measured: 9.2 MB
> transcribes reliably, 18.3 MB returns a 503 at their gateway, 52.9 MB a hard 413.
> Uncompressed wav hits it fast — the same call as mp3 is roughly a tenth of the size.
> Accepting more would only move the failure later and make it look like our bug.

> **`duration_exceeded` is not enforced yet.** Duration is unknown until transcription,
> so the check lands in Phase 2 where the value first exists. Enforcing it at ingest would
> require decoding the container, which is a worse trade than checking it one stage later.
> The byte ceiling bounds the risk in the meantime.

**`202 Accepted`**

```json
{
  "id": "8f14e45f-...",
  "state": "queued",
  "source": "upload",
  "createdAt": "2026-08-10T09:12:04Z",
  "events": "/api/v1/calls/8f14e45f-.../events"
}
```

### `GET /api/v1/calls/:id`

Job state and metadata. A complete substitute for SSE (`docs/Jobs.md`) — no state exists
only in the event stream.

```json
{
  "id": "8f14e45f-...",
  "state": "extracting",
  "source": "upload",
  "durationMs": 1843000,
  "createdAt": "2026-08-10T09:12:04Z",
  "startedAt": "2026-08-10T09:12:05Z",
  "finishedAt": null,
  "exitStatus": null,
  "budget": { "tokensUsed": 41200, "tokenBudget": 120000, "deadlineAt": "..." },
  "failure": null
}
```

`failure` is non-null whenever a job ended in anything but `shipped`:

```json
{
  "failure": {
    "reason": "processing_error",
    "message": "That link is a web page, not an audio file. Use the direct file URL."
  }
}
```

`message` is written for a person and is safe to display. Operator detail — provider
status codes, internal messages — stays in `Job.lastError` and is never returned.

`state` is one of `queued`, `transcribing`, `extracting`, `shipped`, `partial`, `failed`,
`deadline` (ADR-006). `exitStatus` is non-null only in a terminal state.

### `GET /api/v1/calls/:id/events`

Server-Sent Events. Full contract in `docs/Jobs.md`: events `state`, `section`,
`progress`, `terminal`, `error`; monotonic `id` per event; `Last-Event-ID` replay;
`: keepalive` every 15s; stream closes after `terminal`.

```
id: 1041
event: state
data: {"state":"extracting","at":"2026-08-10T09:13:41Z"}

id: 1042
event: section
data: {"section":"objections","status":"complete"}
```

### `GET /api/v1/calls/:id/transcript`

`409 transcript_not_ready` before transcription completes.

```json
{
  "callId": "8f14e45f-...",
  "speakers": ["Rep", "Prospect"],
  "segments": [
    { "id": "seg-8", "index": 8, "speaker": "Prospect",
      "startMs": 76500, "endMs": 83000,
      "text": "We're not sure we can justify that pricing right now." }
  ]
}
```

### `GET /api/v1/calls/:id/notes`

Gated notes. `409 notes_not_ready` until the job is terminal. Available for `partial` and
`deadline` as well as `shipped` — partial content is the point of those states.

```json
{
  "callId": "8f14e45f-...",
  "exitStatus": "partial",
  "summary": "...",
  "intent": { "claim": "...", "quote": "...", "segmentIds": ["seg-20"],
              "startMs": 206500, "endMs": 213000, "speaker": "Prospect" },
  "objections": [ { "claim": "...", "quote": "...", "confidence": 0.62,
                    "segmentIds": ["seg-8"], "startMs": 76500, "endMs": 83000,
                    "speaker": "Prospect" } ],
  "nextSteps": [ /* Evidence[] */ ],
  "followUpEmail": "...",
  "metadata": {
    "droppedClaims": 3,
    "droppedSections": [],
    "promptVersion": "v1",
    "sttModel": "hear",
    "llmModel": "gpt-4o-mini",
    "tokensUsed": 58230,
    "durationMs": 42100,
    "generatedAt": "2026-08-10T09:14:22Z"
  }
}
```

`metadata.droppedClaims` is always present and is intended to be shown, not hidden — see
the sparse-notes section of `docs/Evidence-System.md`.

---

## Export

### `GET /api/v1/calls/:id/export.md`

`text/markdown`, `Content-Disposition: attachment`. Includes quotes and timestamps inline
so the receipts survive leaving the app.

### `GET /api/v1/calls/:id/export.json`

The `/notes` payload verbatim, as a download.

---

## Share

### `POST /api/v1/calls/:id/share`

```json
{ "token": "V1StGXR8_Z5jdHi6B-myT", "url": "https://.../share/V1St...",
  "expiresAt": null, "createdAt": "2026-08-10T09:20:00Z" }
```

Token is 32 CSPRNG bytes, base64url. Never sequential, never derived from the call ID.

### `GET /api/v1/share/:token`

Public, unauthenticated, read-only notes. Returns the same shape as `/notes` minus
`metadata.lastError`-class operator fields. `410 share_expired` once `expiresAt` passes or
`revokedAt` is set. Served with `X-Robots-Tag: noindex`.

> Share hardening beyond an unguessable token — TTL enforcement policy, revocation UI,
> per-token rate limits — is deferred (see `docs/Decisions.md`). This is the highest-risk
> public surface in the product; the deferral is a scheduling decision, not a judgement
> that it is safe.

---

## Rate limits

| Group | Limit |
|-------|-------|
| `POST /api/v1/calls` | 10 / hour / IP |
| `POST /api/v1/calls/:id/share` | 30 / hour / IP |
| `GET /api/v1/share/:token` | 60 / minute / IP |
| Other reads | 300 / minute / IP |

Exceeding a limit returns `429 rate_limited` with `Retry-After`.

---

## Not yet present

Authentication, multi-tenancy, and per-user scoping are deferred (ADR register). Every
endpoint above is currently unauthenticated and single-tenant. This is acceptable for
local and self-hosted single-user operation and is **not** acceptable for a shared
deployment — that gap must close before anything is hosted publicly.
