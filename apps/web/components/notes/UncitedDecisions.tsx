import type { UncitedNotes } from "@opengong/types";

/**
 * What the call settled, as Recap reports it.
 *
 * A section of its own rather than folded into Next steps, because a decision and a task are not the
 * same object: "Six-month term instead of annual" is a fact about the deal, not something anyone has
 * to go and do. Merging them was right for action items, which *were* next steps under another name;
 * it would be wrong here.
 *
 * Same uncited treatment as the action items — dashed edge, no marker rail, no timestamp, nothing
 * clickable — because Recap gives these no quote either, and a reader must be able to tell at a glance
 * which lines they can check.
 */
export function UncitedDecisions({ notes }: { notes: UncitedNotes }) {
  const decisions = notes.keyDecisions ?? [];
  if (decisions.length === 0) return null;

  return (
    <div className="rounded-md border border-dashed border-border bg-raised px-4 py-3.5">
      <ul className="space-y-2">
        {decisions.map((decision, i) => (
          <li key={`${decision}-${i}`} className="text-sm leading-6 text-fg">
            {decision}
          </li>
        ))}
      </ul>

      <p className="mt-3 border-t border-border pt-3 text-[0.6875rem] leading-4 text-subtle">
        From <span className="font-medium">{notes.source}</span>, which reports what was decided but
        not the line it was decided on. Uncited, not unfounded.
      </p>
    </div>
  );
}
