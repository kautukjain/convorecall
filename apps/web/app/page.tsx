import { SiteHeader } from "../components/layout/SiteHeader";
import { StartCall } from "../components/upload/StartCall";

/**
 * How the pipeline works, in three lines. This is the first-run screen, so the one thing
 * worth spending space on is why the notes can be trusted — the rest of the product never
 * gets another chance to explain it.
 */
const STEPS = [
  ["Upload or link", "Audio in, a timed transcript out."],
  ["Claims, then proof", "Each claim is matched back to the words that support it."],
  ["Unmatched is removed", "Not softened, not guessed at, not shipped."],
];

export default function Home() {
  return (
    <>
      <SiteHeader />

      <main className="mx-auto w-full max-w-2xl px-6 py-14 sm:py-20">
        <section>
          <p className="label-eyebrow flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-brand" aria-hidden />
            Evidence-first call notes
          </p>
          <h1 className="text-display mt-4 text-4xl text-fg sm:text-[2.875rem]">
            Deal notes with receipts.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-muted">
            Every claim points at the moment it came from, and anything that cannot be
            matched is removed rather than guessed.
          </p>
        </section>

        <div className="mt-10">
          <StartCall />
        </div>

        <section className="mt-16 border-t border-border pt-8" aria-label="How it works">
          <ol className="grid gap-6 sm:grid-cols-3 sm:gap-5">
            {STEPS.map(([title, detail], i) => (
              <li key={title}>
                <span className="text-xs font-medium tabular-nums text-brand">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h2 className="mt-1.5 text-sm font-medium text-fg">{title}</h2>
                <p className="mt-1 text-xs leading-5 text-subtle">{detail}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </>
  );
}
