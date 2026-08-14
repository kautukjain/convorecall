# Prompting

Prompts live in `packages/prompts` and are versioned (`v1`, …). A prompt that changes
output shape or extraction behaviour gets a new version — shipped versions are never
edited in place, because a stored `promptVersion` that no longer matches its prompt makes
every past result unreproducible.

## Three kinds of prompt

| Kind | Prompts | Input | Output |
|------|---------|-------|--------|
| Evidenced extractor | `objections`, `intent`, `action-items` | Transcript | Claims + quotes |
| Derived synthesizer | `summary`, `follow-up` | Surviving claims **only** | Prose |
| Repair | `repair` | The malformed response + the schema | Corrected JSON |

The split is ADR-013. It is what stops a dropped claim from reappearing in the follow-up
email.

## Principles

- Ask for JSON matching the Zod schema exactly
- Require a verbatim quote for every claim
- Prefer omission over invention — fewer correct claims beat a filled-in template
- Define role, task, constraints, expected JSON, and examples explicitly

## Evidenced extractors

Ask for **`claim` and `quote` only**.

Never ask for line numbers, timestamps, speaker names, or segment IDs. Those are derived
by the matcher from the persisted transcript (`docs/Evidence-System.md`). A model that is
never asked to state a position cannot fabricate one — that is the point.

The same rule now covers **prose**, not just structured fields. The follow-up email prompt
forbids writing any person's name, and forbids placeholders like `[Prospect Name]`. The
greeting is composed from the gate-resolved speaker in
`apps/api/src/modules/notes/recipient.ts`, and omitted when no single recipient is provable —
a four-speaker call gets no greeting rather than a guess. Drafts are never signed, because
nothing in a call identifies which participant is the operator.

The failure this prevents was live: the same call produced `Dear Priya,` on one run and
`Dear [Prospect Name],` on another, because a name only reached the email when the extractor
happened to phrase a claim with one. Identity in customer-facing text is data, not prose.

The quote should be copied from the transcript. Light paraphrase still resolves via the
matcher's second stage; invention does not resolve at all and the claim is dropped.

## Derived synthesizers

Receive the surviving claim set. **Never the raw transcript.**

Do not reintroduce the transcript to make output read better. The guarantee these sections
carry is entirely a property of their input, and adding the transcript back removes it.

## Repair prompt

Fixes structure only. It may coerce types and delete invalid entries. It may not introduce
facts, and it may not add a claim absent from the original response.

Runs at most once per section (`docs/Harness.md`). A repaired response that still fails
validation is discarded, never partially salvaged.

## Prompt injection

Transcript content is untrusted input. Instructions appearing inside a transcript are data,
never commands. Prompts state this explicitly rather than relying on the model to infer it.

## Temperature

`0.2` for extraction. Higher only for follow-up email wording and title generation.

## Testing

Every prompt requires golden tests, schema validation tests, and regression tests. Every
AI bug becomes a new prompt test. Two assertions are mandatory:

- An evidenced extractor never returns a position field
- A derived synthesizer never mentions a claim that was dropped
