# Roadmap

## Shipped — v0.1.0

- Upload, URL, or fixture ingest with content sniffing
- Diarized transcription via PyAI's async job API
- Extraction harness: schema gate, evidence gate, bounded retries, budgets, named exits
- Notes UI with click-a-claim-to-highlight
- Markdown and JSON export, read-only share links
- Eval runner over a hand-authored golden file
- Three sample calls with transcripts and audio

## Before this is safe to host

Not features — these are the gap between "works" and "may be pointed at real calls".

- Authentication and per-user scoping
- Retention and deletion policy; the cascade deletes exist, the policy does not
- Share hardening: TTL enforcement, revocation UI, per-token limits
- Shared-store rate limiting (currently per-instance and in-memory)

## Next

- CRM push (HubSpot, Salesforce) — the "it lived somewhere they never went" problem
- Golden files for the remaining sample calls, so quality is measured on more than one
- **Pass `audio_url` for link ingest.** The provider's batch endpoint accepts a URL it
  fetches itself — no upload, so no size ceiling, and their docs note the input is never
  stored. Today we download the file and re-upload it, which inherits the limit for no
  benefit.
- **Transcode before upload.** Uncompressed wav hits the 12 MB ceiling within a couple of
  minutes; the same audio as 16 kHz mono mp3 is roughly a tenth of the size and is what
  the provider transcribes anyway.
- **Audio chunking.** Measured provider ceiling is ~10 minutes: 20 min returns a 503 at
  the gateway, 32 min a 500. Split longer recordings, transcribe each chunk, and stitch
  with time offsets so segment timings stay true. Until then `UPLOAD_MAX_DURATION_MS`
  advertises 2 hours that will not work.
- Long-transcript chunking for the token budget (separate from the audio limit above)
- Prompt iteration against recall, which currently sits at 2/3–3/3 required and varies
- Observability: metrics, traces, correlation IDs

## Not planned

- A live meeting bot. It is a different product with a different failure mode.
- Coaching scores. Unfalsifiable claims are the thing this project exists to avoid.
