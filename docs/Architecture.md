# Architecture

Map of the system. Each area links to the document that specifies it.

## Overview

```
  [Web · Next.js]
        │  upload / url / fixture
        ▼
  [API · NestJS] ──► Postgres
        │              ▲   ▲
        │ creates      │   │
        ▼              │   │
   jobs row  ──claim──►│   │
        │   SKIP LOCKED    │
        ▼                  │
  [Worker · in-process]    │
        ├── STT ───────────┤ transcript_segments
        ├── extract evidenced sections
        ├── schema gate
        ├── evidence gate
        ├── synthesize derived sections
        └── persist notes + terminal state ─┘
        │
        │ SSE: state · section · progress · terminal
        ▼
  [Web] ◄── notes / transcript / export / share
```

The worker runs inside the API process (ADR-008). `WORKER_ENABLED=false` is the seam for
splitting it out later without a redesign.

## Stack

| Layer | Choice | Record |
|-------|--------|--------|
| Monorepo | pnpm + Turborepo | ADR-001 |
| Web | Next.js App Router, Tailwind, shadcn/ui, TanStack Query | ADR-014 |
| API | NestJS | ADR-005 |
| Persistence | Postgres + Prisma | ADR-005, `docs/Database.md` |
| Queue | `jobs` table, in-process worker | ADR-008, `docs/Jobs.md` |
| Progress | Server-Sent Events | ADR-008 |
| Models | OpenAI-compatible client (PyAI) | ADR-003 |
| Validation | Zod in `packages/validators` | — |

## Packages

| Package | Responsibility |
|---------|----------------|
| `apps/web` | Upload, progress, notes, share |
| `apps/api` | HTTP, storage, worker, harness orchestration |
| `packages/types` | Shared TS types |
| `packages/validators` | Zod schemas |
| `packages/prompts` | Versioned prompt templates |
| `packages/shared` | Job status helpers, evidence matching, budgets |
| `packages/ui` | Design system primitives |
| `packages/config` | ESLint/TS shared config |

## Job lifecycle

`queued` → `transcribing` → `extracting` → (`shipped` | `partial` | `failed` | `deadline`)

Fixture mode enters at `extracting` (ADR-012). Allowed transitions and recovery behaviour
are in `docs/Jobs.md`.

## Where things are specified

| Concern | Document |
|---------|----------|
| Gates, retries, budgets, exit status | `docs/Harness.md` |
| Queue, worker, SSE, failure modes | `docs/Jobs.md` |
| Evidence contract and matching | `docs/Evidence-System.md` |
| Schema and migrations | `docs/Database.md` |
| Endpoints and errors | `docs/API.md` |
| Prompt structure and versioning | `docs/Prompting.md` |
| Every decision and its alternatives | `docs/Decisions.md` |
