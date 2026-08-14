/** Intrinsic size of both logo files (`viewBox="40 250 1590 400"`), which fixes the aspect ratio. */
const LOGO = { width: 1590, height: 400 } as const;

/**
 * The supplied lockup, one file per theme.
 *
 * This replaced a hand-drawn waveform mark plus the product name set in the display serif. The
 * letterforms are paths inside the artwork now, so there is no live text here at all — which is
 * why both images carry an `alt`. The old hand-drawn mark is archived at
 * `assets/icons/legacy-mark.svg`; the favicon is now `app/icon.png`, generated from the supplied
 * icon (see `assets/icons/README.md`).
 *
 * Two `<img>` rather than one inline `<svg>`: the files are ~136 KB each of auto-traced paths, and
 * inlining either would put that in the HTML of every page. As files they are fetched once and
 * cached. The unused variant is `display: none` — fetched but idle, which is the price of getting
 * the right mark on first paint instead of swapping `src` on the client and flashing the wrong one.
 *
 * **Shown whole. Do not try to crop the tagline off.**
 *
 * The artwork is a full lockup: mark, name, and "What was said. What backs it up. What's next."
 * underneath. At the ~22px a 56px header allows, that tagline renders about four pixels tall, so
 * cropping it is tempting. It does not work, and the geometry says why — measured from the real path
 * bounding boxes inside `viewBox="40 250 1590 400"`:
 *
 *     mark (left)          y 265 – 643   ← spans essentially the full height
 *     name + tagline       y 350 – 597
 *
 * The mark is taller than the text it sits beside, so every horizontal cut that removes the tagline
 * also slices the bottom off the mark. An earlier version of this file cropped at y 515 with
 * `object-cover object-top` and did exactly that. The measurement behind it was wrong: it clustered
 * `translate(x, y)` origins, which are where each path starts, not the box it occupies — and this
 * artwork's path data carries large negative offsets, so the origin says nothing about the extent.
 *
 * Removing the tagline needs a wordmark-only export from the designer, not CSS.
 *
 * Height is fixed and width follows the intrinsic ratio, so the header's row does not reflow when the
 * images land.
 */
export function Wordmark() {
  return (
    <span className="inline-flex items-center">
      <img
        src="/logo/convorecall-on-light.svg"
        alt="ConvoRecall"
        width={LOGO.width}
        height={LOGO.height}
        className="art-light h-6 w-auto"
      />
      <img
        src="/logo/convorecall-dark.svg"
        alt="ConvoRecall"
        width={LOGO.width}
        height={LOGO.height}
        className="art-dark h-6 w-auto"
      />
    </span>
  );
}
