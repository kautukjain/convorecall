# AI Pipeline

Overview. The normative specification is `docs/Harness.md`.

1. **Ingest** — validate and store audio (`docs/API.md`)
2. **Transcribe** — STT with speaker labels; segments persisted
3. **Extract evidenced sections (parallel)** — `objections`, `intent`, `nextSteps`
4. **Schema gate** — Zod parse; one repair attempt, then drop the section
5. **Evidence gate** — each claim's quote must resolve to a transcript span, or the claim
   is dropped and counted (`docs/Evidence-System.md`)
6. **Synthesize derived sections** — `summary`, `followUpEmail`, generated from the
   surviving claims only, never from the raw transcript (ADR-013)
7. **Schema gate** — same treatment for the derived payload
8. **Exit** — `shipped` · `partial` · `failed` · `deadline`, resolved in that precedence
   order (ADR-011)

Fixture mode (ADR-012) enters at step 3 with a supplied transcript and skips steps 1–2.

**Why extraction splits in two.** Derived prose cannot carry a per-claim receipt, and
checking generated prose against a transcript after the fact is unreliable. Gating between
the two stages means a dropped claim can never reappear in the summary or the email,
because those prompts never saw it.

Budgets, retry classes, and capability IDs come from config — see the tables in
`docs/Harness.md`.
