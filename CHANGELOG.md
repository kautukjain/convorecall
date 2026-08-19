# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.1.0] — 2026-08-14

First working version. The whole path runs: upload or sample call → diarized transcript →
notes where every claim is quoted → export and share.

### Added

- **Evidence gate.** A claim ships only if its quote resolves to a real transcript span.
  The model supplies a claim and a quote; position and speaker are derived by the matcher,
  so a fabricated location is not possible (ADR-009).
- **Harness.** Schema gate with one repair attempt, transport retry bounded at three with
  jittered backoff, token and wall-clock budgets checked before spending, and four named
  exit statuses (`shipped` · `partial` · `failed` · `deadline`).
- **Two-stage extraction.** Evidenced sections are gated before the summary and follow-up
  email are written, and those receive only surviving claims — so a dropped claim cannot
  reappear in prose (ADR-013).
- **Jobs.** Postgres `jobs` table as the queue, atomic `SKIP LOCKED` claim, heartbeat,
  stale reclaim, and deadline sweep. A crashed worker cannot strand a job.
- **Speech-to-text** via PyAI's async transcription job API with diarization.
- **API.** `/api/v1` with problem+json errors, SSE progress with `Last-Event-ID` replay,
  Markdown and JSON export, and share links.
- **Web.** Next.js UI with click-a-claim-to-highlight, and a public read-only share page.
- **Evals.** `pnpm eval` scores the gate against a hand-authored golden file; `--live`
  runs the deployed pipeline and reports recall.
- **Sample calls.** Three hand-authored transcripts (discovery, objection, enterprise)
  with rendered audio.

### Known limitations

- No authentication; every endpoint is unauthenticated and single-tenant.
- No retention or deletion policy. Do not point this at real customer calls yet.
- Extraction varies run to run — one eval run is not a measurement.
- `demo-call` and `support-call` have no transcript and are disabled in the UI.
- Long-transcript chunking is not implemented; cap demo calls at roughly 15 minutes.

[unreleased]: https://github.com/OWNER/convorecall/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/OWNER/convorecall/releases/tag/v0.1.0
