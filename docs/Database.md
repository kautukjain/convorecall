# Database

Postgres via Prisma (ADR-005). The `jobs` table doubles as the work queue (ADR-008).

Connection string via `DATABASE_URL` only — never assembled from parts, never defaulted.

---

## Schema

```prisma
enum CallSource      { UPLOAD  URL  FIXTURE }
enum JobState        { QUEUED  TRANSCRIBING  EXTRACTING  SHIPPED  PARTIAL  FAILED  DEADLINE }
enum NotesExitStatus { SHIPPED  PARTIAL  FAILED  DEADLINE }

model Call {
  id           String    @id @default(uuid()) @db.Uuid
  source       CallSource
  sourceRef    String?                        // original URL, or fixture name
  storageKey   String?                        // opaque; never a filesystem path
  originalName String?
  mimeType     String?
  sizeBytes    Int?
  durationMs   Int?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  job      Job?
  segments TranscriptSegment[]
  notes    Notes?
  shares   Share[]

  @@index([createdAt])
}

model Job {
  id            String    @id @default(uuid()) @db.Uuid
  callId        String    @unique @db.Uuid
  call          Call      @relation(fields: [callId], references: [id], onDelete: Cascade)

  state         JobState  @default(QUEUED)
  attempt       Int       @default(0)
  claimedBy     String?                       // worker instance id
  heartbeatAt   DateTime?
  startedAt     DateTime?
  finishedAt    DateTime?
  deadlineAt    DateTime                      // set at creation from JOB_DEADLINE_MS

  tokenBudget   Int
  tokensUsed    Int       @default(0)

  failureReason  String?                      // 'orphaned' | 'processing_error' | ...
  failureMessage String?                      // client-safe explanation; shown in the UI
  lastError      String?                      // operator-facing; never returned to clients

  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  events JobEvent[]

  @@index([state, createdAt])                 // claim query
  @@index([state, heartbeatAt])               // stale sweep
  @@index([state, deadlineAt])                // deadline sweep
}

model JobEvent {
  id        BigInt   @id @default(autoincrement())   // monotonic; SSE Last-Event-ID
  jobId     String   @db.Uuid
  job       Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  type      String                                   // state | section | progress | terminal | error
  payload   Json
  createdAt DateTime @default(now())

  @@index([jobId, id])
}

model TranscriptSegment {
  id       String @id @default(uuid()) @db.Uuid
  callId   String @db.Uuid
  call     Call   @relation(fields: [callId], references: [id], onDelete: Cascade)

  index    Int                                       // ordinal within the call
  speaker  String
  startMs  Int
  endMs    Int
  text     String

  @@unique([callId, index])
  @@index([callId, startMs])
}

model Notes {
  id              String          @id @default(uuid()) @db.Uuid
  callId          String          @unique @db.Uuid
  call            Call            @relation(fields: [callId], references: [id], onDelete: Cascade)

  exitStatus      NotesExitStatus
  payload         Json                          // CallNotes, validated by packages/validators

  droppedClaims   Int             @default(0)
  droppedSections String[]        @default([])

  promptVersion   String
  sttModel        String?                       // null in fixture mode (ADR-012)
  llmModel        String
  tokensUsed      Int
  durationMs      Int

  generatedAt     DateTime        @default(now())
}

model Share {
  id        String    @id @default(uuid()) @db.Uuid
  token     String    @unique                   // 32 bytes, base64url, CSPRNG
  callId    String    @db.Uuid
  call      Call      @relation(fields: [callId], references: [id], onDelete: Cascade)
  expiresAt DateTime?
  revokedAt DateTime?
  createdAt DateTime  @default(now())

  @@index([callId])
}
```

---

## Design notes

**`payload` is JSON, but validated.** Notes shape evolves through the build; a normalized
claim table would mean a migration per prompt change. The payload is parsed with
`CallNotesSchema` on write *and* on read, so JSON storage never becomes untyped storage.
`droppedClaims` and `droppedSections` are promoted to columns because exit status and eval
metrics query them.

**`JobEvent` is append-only** and exists so SSE reconnection can replay (`docs/Jobs.md`).
The `BigInt` autoincrement is the `Last-Event-ID`. Without a persisted event log, a client
that reconnects has no way to learn what it missed.

**Failures have two audiences.** `failureMessage` is what a user reads and is safe to
return; `lastError` carries the provider status, stack context, and anything else an
operator needs, and never leaves the server. Collapsing them into one field either leaks
internals or tells the user nothing — the second is what shipped first.

**`storageKey` is opaque.** Never a filesystem path, never derived from the uploaded
filename. Names are generated; the original is kept in `originalName` for display only.

**Cascades are deliberate.** Deleting a `Call` removes its job, events, segments, notes,
and shares. This is the primitive the deferred retention policy will build on — the
deletion path exists before the policy that will need it.

**One job per call.** `callId` is unique on `Job`. Re-analysis creates a new `Call`. This
keeps the queue claim trivially correct and avoids a job-history table nothing needs yet.

---

## Migrations

- Prisma Migrate. Every schema change ships as a checked-in migration; `db push` is for
  local scratch only and never for anything that reaches `main`.
- Migrations run explicitly on deploy (`prisma migrate deploy`), never automatically at
  application startup — a boot that silently mutates a schema is how two instances corrupt
  each other during a rolling restart.
- `pnpm setup` provisions the local database and applies migrations.

## Local development

Postgres via `infra/compose`. Nothing in the schema requires an extension, so a plain
`postgres:16` image is sufficient and a fork needs no managed service to get running.

```bash
pnpm setup      # starts Postgres, waits for health, applies migrations
pnpm db:up      # container only
pnpm db:migrate # migrations only
```

**Host port is 5433, not 5432.** A locally installed Postgres almost always owns 5432, and
connecting to the wrong server produces a confusing `P1010 denied access` rather than an
honest failure. The container still listens on 5432 internally.

**`.env` lives at the repo root.** Prisma looks for `.env` beside the schema, so a bare
`prisma` invocation inside `apps/api` will not find `DATABASE_URL`. Use the root
`pnpm db:*` scripts, which run from the root where `.env` is, or export `DATABASE_URL`
yourself.

## Prisma version

Pinned to Prisma 6. Prisma 7 removes `url` from the datasource block and requires a
`prisma.config.ts` plus a driver adapter; `@prisma/config` also does not resolve cleanly
under this pnpm layout. Every piece of Prisma documentation and community material assumes
the version-6 form, which matters for a repo meant to be cloned and understood quickly.
Upgrading is tracked in the deferred register.

## Deferred

Retention, deletion policy, and PII handling are open (see the deferred register in
`docs/Decisions.md`). The cascade behaviour above is deliberately in place so that when a
policy lands it is a scheduler over existing deletes rather than a schema change.
