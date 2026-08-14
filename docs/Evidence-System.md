# Evidence System

The evidence gate is the product. Everything else is a pipeline around it.

Governed by ADR-002, ADR-009, ADR-013. Normative (ADR-004).

---

## Contract

```ts
type Evidence = {
  claim: string;            // model-supplied
  quote: string;            // model-supplied, from the transcript
  confidence?: number;      // model-supplied, 0..1, advisory only

  // Derived by the matcher. Never model-supplied.
  segmentIds: string[];
  startMs: number;
  endMs: number;
  speaker: string;
};
```

**The split is the whole design.** The model supplies only what it can be held to — a
claim and the words it believes support it. Position, timing, and speaker are *computed*
from the persisted transcript by the matcher. A model that cannot assert a line number
cannot fabricate one, which makes position the one field in the payload that is
structurally trustworthy.

Anything a model emits in a derived field is discarded before matching, not merged, not
used as a hint.

### confidence

Optional, advisory, and never a gate (ADR-009). It exists for one job: letting the UI show
a weak-but-genuinely-evidenced claim with a visible caveat instead of dropping it. Model
self-assessed confidence is poorly correlated with correctness, so it is never permitted
to decide what ships. Below `0.70` the UI marks the claim; it still renders.

---

## Matching

Two stages against the persisted `transcript_segments`, in order. First hit wins.

### Normalization

Applied to both the quote and the transcript before comparison:

1. Unicode NFKC
2. Lowercase
3. Curly quotes and dashes folded to ASCII
4. **Contractions canonicalized** — `we're` → `we are`, `didn't` → `did not`,
   `won't` → `will not`. Applied to both sides, so consistency matters more than
   linguistic correctness. `'s` is left alone: it is ambiguous between "is" and a
   possessive, and expanding it would turn `Dave's team` into `dave is team`.
5. **Intra-word hyphens split to spaces** — `buy-in` becomes `buy in`
6. Whitespace runs collapsed to a single space
7. Punctuation stripped at token boundaries only — never inside a token, so `$40k` and
   `12.5%` survive intact
8. Trim

Step 5 also came from real data rather than reasoning. Spike 2a showed the provider
transcribes the compound as **`buy in`**, while a model quoting the same moment writes
**`buy-in`** — and the claim was dropped. Splitting on both sides makes the two renderings
agree. Real STT output is lowercase and unpunctuated, so normalization is not a nicety
here; it is the only reason model-written quotes resolve at all.

Step 4 is load-bearing, and it was added because the implementation disproved an earlier
version of this document. Speech transcripts are full of contractions and models routinely
expand them when quoting. Without folding, token similarity scores `we're` against
`we are` at **0.67** — below threshold, so a perfectly honest quote gets dropped. With
folding it is an exact match.

Normalization is applied to a *concatenation of segments with their offsets retained*, so
a match found in normalized space can be mapped back to real segment IDs and millisecond
offsets. Losing that mapping is the most common way a matcher of this kind silently breaks.

### Stage 1 — exact normalized substring

The normalized quote appears verbatim in the normalized transcript. This covers the large
majority of well-behaved model output and is the cheap path.

### Stage 2 — windowed token similarity

Only if Stage 1 fails. A sliding window over transcript tokens, sized to the quote's token
count ±25%, scored by token-level similarity. A window scoring at or above
`EVIDENCE_MATCH_THRESHOLD` (0.85) is a match; the best-scoring window wins.

Stage 2 exists because a model that lightly paraphrases — dropping a filler word, fixing
the speaker's grammar — is not hallucinating, and dropping those claims makes the sparse
notes problem materially worse for no gain in trust.

### Cross-segment matching

Windows are evaluated over the concatenated transcript, so a quote spanning a segment
boundary resolves normally and returns every segment it touched in `segmentIds`. Speakers
change at segment boundaries; a quote spanning two speakers resolves to the segment
containing the **majority of matched tokens**, and the crossing is recorded so the UI can
highlight the full span while attributing it to one speaker.

### Span resolution

On a match the matcher returns:

- `segmentIds` — every segment the matched window overlaps, in transcript order
- `startMs` — start of the first matched segment
- `endMs` — end of the last matched segment
- `speaker` — speaker of the majority segment

Timing is segment-granular, not word-granular. Word-level offsets would require
word-level STT timestamps, which ADR-003 flags as unverified for the chosen provider.
Segment granularity is sufficient for click-to-highlight and does not gamble on a provider
capability that may not exist.

---

## Worked examples

Drawn from the hand-authored fixture `sample-data/transcripts/objection-call.json`, which
is the ground truth for `evals/objections/objection-call.golden.json` (ADR-015).

Transcript (normalized, segment IDs shown):

```
seg-8   Prospect  We're not sure we can justify that pricing right now.
seg-9   Rep       Totally fair. What would need to be true for it to make sense?
seg-10  Prospect  Honestly, we'd need buy-in from finance, and Dave owns that.
```

| # | Model quote | Stage | Result |
|---|-------------|-------|--------|
| 1 | `We're not sure we can justify that pricing` | 1 | Match → `[seg-8]`, speaker `Prospect` |
| 2 | `we are not sure we can justify that pricing` | 1 | Contraction folded → exact match → `[seg-8]` |
| 3 | `we're not sure we can justify the pricing right now` | 2 | `that`→`the` drift, 0.9 → match → `[seg-8]` |
| 4 | `we'd need buy-in from finance and Dave owns that` | 1 | Match → `[seg-10]` (comma stripped at boundary) |
| 5 | `for it to make sense? Honestly, we'd need buy-in from finance...` | 1 | Spans `[seg-9, seg-10]`; majority tokens in seg-10 → speaker `Prospect` |
| 6 | `The customer said the price was too high` | — | Below threshold → **dropped**, `droppedClaims++` |
| 7 | `We need approval from procurement` | — | No match → **dropped** (plausible, unsaid) |

Every row above is asserted as a test in `packages/shared/src/evidence.spec.ts`. If this
table and the implementation disagree again, the test fails.

Examples 5 and 6 are the gate working. Both are reasonable paraphrases of things that were
roughly meant; neither is something anyone actually said. Shipping them is precisely the
failure the product exists to prevent.

---

## Drop policy

| Situation | Action |
|-----------|--------|
| Quote does not resolve | Drop the claim, `droppedClaims++` |
| All claims in a section dropped | Section counts as dropped (`droppedSections`) |
| Claim resolves, `confidence < 0.70` | Ships, marked low-confidence in UI |
| Model supplies `segmentIds` / timing | Discarded before matching |

Dropped claims are **counted, never silently discarded**. The count drives exit status
(ADR-011) and is surfaced in the notes payload so the reader knows something was removed.

---

## Derived sections

`summary` and `followUpEmail` carry no receipts. Their guarantee comes from their input
(ADR-013): they are synthesized in a second pass whose only factual input is the surviving
claim set — never the raw transcript.

The consequence is worth stating plainly: **a dropped objection cannot appear in the
follow-up email**, because the email prompt never saw it. The gate composes forward
instead of needing to be re-run against prose.

Prompt tests must assert this directly — feed a claim set with a known removal and confirm
the derived text does not mention it.

---

## The sparse-notes failure mode

A strict gate plus a poor transcript produces few claims. This is the designed cost of
ADR-002 and the most likely way the product disappoints someone. It is planned for, not
discovered:

1. **Stage 2 matching** keeps honest paraphrases that exact matching would lose.
2. **Low-confidence claims ship marked** rather than being dropped, so weak evidence is
   visible rather than absent.
3. **`droppedClaims` is always shown.** "3 claims were removed because they could not be
   verified" is a trust-building statement. Silently returning three bullet points is not.
4. **`partial` is rendered as unremarkable.** It is the expected common case on real audio;
   styling it as a warning trains users to distrust a working system.
5. **Transcript quality is surfaced separately** from notes quality, so a bad STT result
   reads as a bad recording rather than a bad product.

The alternative — relaxing the gate when results look thin — is the one change that would
make this product identical to everything it competes with.

---

## The matcher must never

- Accept a model-supplied position, or use one as a search hint
- Match against anything but the persisted transcript
- Lower the threshold at runtime based on how many claims survived
- Return a match without concrete `segmentIds`
- Treat a partial-window match as a full-span match

---

## Test obligations

- [ ] Exact quote resolves to the correct single segment
- [ ] Light paraphrase above threshold resolves; below threshold drops
- [ ] Quote spanning two segments returns both IDs and the majority speaker
- [ ] Fabricated quote drops and increments `droppedClaims`
- [ ] Model-supplied `segmentIds` are ignored even when correct
- [ ] Punctuation inside tokens (`$40k`, `12.5%`) survives normalization
- [ ] `buy-in` and `buy in` resolve to the same span
- [ ] A dropped claim never appears in the derived follow-up email
- [ ] An all-dropped section is recorded in `droppedSections`
