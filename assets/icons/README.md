# assets/icons

`convorecall-icon.webp` is the source app icon: the teal recall arrow around the waveform, on a navy
tile. **It is not served directly.** Next.js's `icon` file convention accepts `.ico`, `.jpg`, `.jpeg`,
`.png` and `.svg` — not `.webp` — so the served files are generated from it into `apps/web/app/`,
where the App Router picks them up and writes the `<link>` tags itself.

Regenerate after changing the source:

```bash
# ffmpeg's webp decoder re-initialises the filter graph mid-run, so pad/scale in a second pass.
ffmpeg -y -i assets/icons/convorecall-icon.webp /tmp/icon-raw.png

PAD="pad='max(iw,ih)':'max(iw,ih)':'(ow-iw)/2':'(oh-ih)/2':color=0x0C141F"
ffmpeg -y -i /tmp/icon-raw.png -vf "$PAD,scale=512:512:flags=lanczos" apps/web/app/icon.png
ffmpeg -y -i /tmp/icon-raw.png -vf "$PAD,scale=180:180:flags=lanczos" apps/web/app/apple-icon.png
```

The source is 467×443, so it is padded to a square with `#0C141F` — sampled from the tile's own
corners — rather than stretched or cropped. Stretching would skew the circle by 5%; cropping to 443
square would clip the arrowhead.

`legacy-mark.svg` is the earlier hand-drawn mark (three waveform bars, then a tick) that served as
both the header logo and the favicon before this icon replaced it. Kept for provenance only; nothing
references it.
