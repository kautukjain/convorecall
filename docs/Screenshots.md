# Screenshots

Captured from a production build (`pnpm --filter @opengong/web build && pnpm start`) at
2× device scale. Regenerate after any UI change — a stale screenshot is a lie with a long
half-life.

## Start

![Start a call](../assets/screenshots/01-start.png)

Upload a recording, or run one of the sample calls. Calls without a written transcript
fixture are disabled rather than hidden, so it is obvious what exists.

## Notes with receipts

![Deal notes with evidence](../assets/screenshots/02-notes.png)

The demo-critical screen. Every claim carries its quote, speaker, and timestamp, and
clicking one scrolls the transcript to that moment and pulses it.

Shown here is `enterprise-call` — four speakers, and each objection attributed to the
person who raised it: the VP of Sales on adoption, Security on the data processing
agreement, Procurement on contract term.

## Share link

![Public share page](../assets/screenshots/03-share.png)

Read-only, `noindex`, no operator telemetry. This is the screen that goes on a second
screen during the demo.

## Regenerating

```bash
pnpm --filter @opengong/web build
(cd apps/web && pnpm start &)

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=1440,620 --screenshot=assets/screenshots/01-start.png http://localhost:3000
```

Shoot against a production build, not `pnpm dev` — the dev build paints a Next.js badge
over the corner of the page.
