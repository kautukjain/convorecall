# ConvoRecall vs Gong — files to send a colleague

Public URL (local): [http://localhost:3000/convorecall-vs-gong](http://localhost:3000/convorecall-vs-gong)

This feature is a **new App Router page**. It does not change calls, notes, share, the API, or env.

## Send these (new)

| File | Role |
|------|------|
| `apps/web/app/convorecall-vs-gong/page.tsx` | Route + metadata. Slug: `convorecall-vs-gong` |
| `apps/web/app/convorecall-vs-gong/FILES.md` | This list |
| `apps/web/components/compare/GongComparison.tsx` | Page UI (table, price cards, CTAs) |
| `apps/web/lib/gong-comparison.ts` | All comparison copy — edit this to change rows |

## Also send (small edits)

| File | What changed |
|------|----------------|
| `apps/web/app/page.tsx` | Home page link to `/convorecall-vs-gong` |
| `apps/web/app/globals.css` | `elev-compare` and `elev-compare-brand` utilities |

## Already in the app (do not send)

These are imported by the page but already exist:

- `apps/web/components/layout/SiteHeader.tsx`
- `apps/web/components/ui/SectionLabel.tsx`

## Do not need

- Anything under `apps/api/`
- `CallView`, notes, audio player, share page
- Logo SVGs (the comparison page uses the text “ConvoRecall”, not the header lockup)
- `.env`

To change claims or price copy, edit `apps/web/lib/gong-comparison.ts` only.
