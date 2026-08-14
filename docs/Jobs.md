# Jobs

How analysis work is queued, executed, observed, and recovered.

Governed by ADR-008. State vocabulary from ADR-006. Normative (ADR-004).

---

## Model

There is no queue service. The `jobs` table **is** the queue.

```
POST /api/v1/calls
      │
      ▼
  create Call + Job row (state = QUEUED)   ← durable record exists before any work
      │
      ▼  returns 202 + job id immediately
      
  worker loop (in-process, Nest provider)
      │
      ├─ claim one row      SELECT ... FOR UPDATE SKIP LOCKED
      ├─ heartbeat every WORKER_HEARTBEAT_MS
      ├─ run the harness    (docs/Harness.md)
      └─ write terminal state + notes
```

The row is created inside the same transaction as the `Call`, before the HTTP response is
sent. There is no window in which a call exists without a job record — that window is how
"every job leaves a record" quietly becomes false.

---

## States

```
QUEUED ──► TRANSCRIBING ──► EXTRACTING ──► SHIPPED
   │             │               │      └─► PARTIAL
   │             │               │      └─► DEADLINE
   └─────────────┴───────────────┴────────► FAILED
```

Fixture mode (ADR-012) enters directly at `EXTRACTING`; `TRANSCRIBING` is skipped and
`sttModel` is recorded as `null`.

**Allowed transitions.** Anything not listed is a bug and must throw rather than be
silently written.

| From | To |
|------|-----|
| `QUEUED` | `TRANSCRIBING`, `EXTRACTING` (fixture), `FAILED`, `DEADLINE` |
| `TRANSCRIBING` | `EXTRACTING`, `FAILED`, `DEADLINE` |
| `EXTRACTING` | `SHIPPED`, `PARTIAL`, `FAILED`, `DEADLINE` |
| any terminal | — (terminal states are final) |

---

## Claiming

```sql
UPDATE jobs SET
  state       = 'TRANSCRIBING',
  claimed_by  = $worker_id,
  started_at  = now(),
  heartbeat_at= now(),
  attempt     = attempt + 1
WHERE id = (
  SELECT id FROM jobs
  WHERE state = 'QUEUED'
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;
```

`SKIP LOCKED` is what makes this safe with more than one API instance: two workers racing
for the same row cannot both win, and neither blocks. This is the property that lets the
queue be a table without becoming a correctness problem later.

Workers poll every `WORKER_POLL_INTERVAL_MS` and run at most `WORKER_CONCURRENCY` jobs
each.

---

## Liveness and recovery

The failure invariant depends entirely on this section.

**Heartbeat.** A running worker writes `heartbeat_at = now()` every
`WORKER_HEARTBEAT_MS`. The write is independent of pipeline progress, so a job stuck
inside a slow model call still looks alive — which is correct, because it is.

**Stale detection.** A non-terminal job whose `heartbeat_at` is older than
`WORKER_STALE_AFTER_MS` is considered abandoned. Its worker crashed, was killed, or lost
the database.

**Reclaim.** A sweep runs on startup and on an interval:

| Condition | Action |
|-----------|--------|
| Stale, `attempt < JOB_MAX_ATTEMPTS` | Reset to `QUEUED` for another worker |
| Stale, `attempt >= JOB_MAX_ATTEMPTS` | Terminal `FAILED`, `failureReason = 'orphaned'` |
| Non-terminal, past `deadline_at` | Terminal `DEADLINE`, partial content preserved |

Because reclaim runs on startup, a process that dies mid-`EXTRACTING` cannot leave a job
hanging past one restart. This is the difference between the failure invariant being true
and being aspirational.

**Idempotency.** Reclaimed jobs re-run from the last persisted stage, not from scratch.
Transcript segments already written are reused, so a crash during extraction does not
re-pay for STT. Notes are written once, at the end, in a single transaction with the
terminal state — there is no state in which a job is `SHIPPED` without notes.

---

## Progress: Server-Sent Events

`GET /api/v1/calls/:id/events`

`text/event-stream`. One stream per call. The stream closes after a terminal event.

| Event | Payload | When |
|-------|---------|------|
| `state` | `{state, at}` | Every state transition |
| `section` | `{section, status}` | An extractor section completes or is dropped |
| `progress` | `{stage, pct}` | Coarse progress within transcription |
| `terminal` | `{exitStatus, droppedClaims, droppedSections}` | Once, then the stream closes |
| `error` | `{code, message}` | Unrecoverable error; stream closes |

**Reconnection.** Every event carries a monotonic `id`. A client reconnecting with
`Last-Event-ID` receives events since that id, replayed from the job row and its state
history. A client that reconnects after the job finished immediately receives `terminal`
and the stream closes — reconnecting late is never a hang.

**Heartbeat comments.** A `: keepalive` comment every 15s prevents intermediary proxies
from closing an idle stream during a long transcription.

**Polling fallback.** `GET /api/v1/calls/:id` returns the same state and is a complete
substitute for clients that cannot hold a connection. SSE is an optimization, never a
requirement — no state exists only in the event stream.

---

## Failure modes

Each is a designed behaviour, not an incident.

| Mode | Behaviour | Terminal state |
|------|-----------|----------------|
| Worker process dies | Stale heartbeat → reclaimed or orphaned | `QUEUED` again, then eventually `FAILED` |
| STT provider down | Transport retries exhausted | `FAILED` |
| Model returns garbage repeatedly | Schema gate drops sections | `PARTIAL` or `FAILED` |
| Transcript too poor to match quotes | Evidence gate drops claims | `PARTIAL` |
| Job exceeds wall clock or tokens | Governor stops, content preserved | `DEADLINE` |
| Client disconnects | Work continues; nothing depends on the connection | unchanged |
| Two workers race for a row | `SKIP LOCKED` — one wins, one moves on | unchanged |

---

## Configuration

| Key | Default | Meaning |
|-----|---------|---------|
| `WORKER_CONCURRENCY` | 2 | Jobs in flight per instance |
| `WORKER_POLL_INTERVAL_MS` | 2000 | Claim attempt interval |
| `WORKER_HEARTBEAT_MS` | 10000 | Liveness write interval |
| `WORKER_STALE_AFTER_MS` | 60000 | Abandonment threshold |
| `JOB_MAX_ATTEMPTS` | 3 | Reclaims before orphaned |
| `WORKER_ENABLED` | true | Off = API serves but processes nothing |

`WORKER_ENABLED=false` is the seam for extracting a separate worker process later without
redesign: run one instance with the worker off and another with it on. The queue is
already a table and the claim is already atomic, so nothing else changes.

---

## Test obligations

- [ ] A job row exists before `POST /api/v1/calls` returns
- [ ] Two concurrent workers never claim the same row
- [ ] A job killed mid-`EXTRACTING` reaches a terminal state after restart
- [ ] Exceeding `JOB_MAX_ATTEMPTS` yields `FAILED` with reason `orphaned`
- [ ] A reclaimed job reuses existing transcript segments and does not re-run STT
- [ ] An illegal transition (e.g. `SHIPPED` → `EXTRACTING`) throws
- [ ] SSE reconnect with `Last-Event-ID` loses no events
- [ ] Connecting to `/events` after completion yields `terminal` immediately
