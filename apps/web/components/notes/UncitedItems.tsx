import type { UncitedNotes } from "@convorecall/types";

/**
 * Next steps that arrived without a quote, shown inside the Next steps section.
 *
 * **Uncited, not unverified.** PyAI Recap derives these from the call and they are generally right;
 * what is missing is a quote, so there is no moment to jump to and the evidence gate has nothing to
 * resolve. They sit under the section a reader actually came for rather than in a section of their
 * own, because the citation distinction is ours to manage, not theirs to navigate.
 *
 * What keeps ADR-002 satisfied is that they still look different: no marker rail, no timestamp, and
 * not clickable — there is nowhere to click to. A claim the reader can check must not be
 * indistinguishable from one they cannot.
 *
 * The caption below is careful about whose limitation this is. It said "they cannot be traced to a
 * moment in the call", which is a claim about the call and is false: on `discovery-call` the
 * commitments are spoken plainly at 2:25, 2:42 and 2:48. What is true is that Recap hands over a
 * paraphrase with no quote, so *our matcher* has nothing to resolve. Blaming the recording for a gap
 * in the vendor's output is exactly the kind of overstatement this product exists to refuse.
 */
export function UncitedItems({ notes }: { notes: UncitedNotes }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-raised px-4 py-3.5">
      <ul className="space-y-2">
        {notes.actionItems.map((item, i) => (
          <li key={`${item.task}-${i}`} className="text-sm leading-6 text-fg">
            {item.task}
            {(item.owner ?? item.due) && (
              <span className="ml-2 text-xs text-subtle">
                {item.owner}
                {item.owner && item.due ? " · " : ""}
                {item.due}
              </span>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-3 border-t border-border pt-3 text-[0.6875rem] leading-4 text-subtle">
        From <span className="font-medium">{notes.source}</span>, which reports the task, owner and
        due date but not the line they came from. Nothing to match means no timestamp &mdash; these
        are uncited, not unfounded.
      </p>
    </div>
  );
}
