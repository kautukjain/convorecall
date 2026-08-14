import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { Wordmark } from "./Wordmark";

/**
 * One header on every screen, which is most of what makes a set of pages feel like a
 * product. It sticks, because on the notes screen the transcript scrolls for a long time
 * and losing the masthead makes the page feel like a document that fell out of the app.
 *
 * Translucent over blur where the browser supports it, opaque where it does not — content
 * scrolling visibly under a hairline reads as depth without a shadow or a gradient.
 */
export function SiteHeader({
  children,
  showThemeToggle = true,
}: {
  /** Screen-specific controls, right-aligned before the theme toggle. */
  children?: ReactNode;
  showThemeToggle?: boolean;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg supports-backdrop-filter:bg-bg/80 supports-backdrop-filter:backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-4 px-6">
        <Link
          href="/"
          className="rounded-sm transition-opacity duration-150 hover:opacity-70"
          aria-label="ConvoRecall, home"
        >
          <Wordmark />
        </Link>
        <div className="ml-auto flex items-center gap-3">
          {children}
          {showThemeToggle && <ThemeToggle />}
        </div>
      </div>
    </header>
  );
}
