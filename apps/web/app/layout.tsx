import type { Metadata } from "next";
import { Instrument_Sans, Newsreader } from "next/font/google";
import type { ReactNode } from "react";
import { THEME_INIT_SCRIPT } from "../components/layout/ThemeToggle";
import "./globals.css";

/*
 * Two families, each with one job (.cursor/rules/design-system.mdc allows a display face
 * alongside the interface face; it does not permit a third). next/font self-hosts both at
 * build time, so there is no third-party request at runtime and no layout shift.
 *
 * Instrument Sans is the interface: grotesque, slightly narrow, high x-height, which is
 * what keeps a 12px metadata row readable. Newsreader is the document: page titles, the
 * summary, and quoted speech. Both are variable, so weight is a continuum rather than
 * four separate downloads.
 */
const sans = Instrument_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-instrument-sans",
});

const serif = Newsreader({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-newsreader",
  // Newsreader's optical size axis. Worth the bytes: it is what stops the display weight
  // from looking spindly at 40px and muddy at 15px.
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: "ConvoRecall",
  description: "Deal notes with receipts from any call.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${serif.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Applies the stored theme before first paint. Anything later flashes. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
