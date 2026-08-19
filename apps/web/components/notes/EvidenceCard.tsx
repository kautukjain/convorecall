"use client";

import { CornerDownRight, TriangleAlert } from "lucide-react";
import type { Evidence } from "@convorecall/types";
import { timestamp } from "../../lib/format";
import { SpeakerAvatar } from "../ui/SpeakerChip";

export function EvidenceCard({
  evidence,
  active,
  onSelect,
}: {
  evidence: Evidence;
  active: boolean;
  /** Receives the whole evidence: the transcript needs its ids, the player its offset. */
  onSelect: (evidence: Evidence) => void;
}) {
  const lowConfidence =
    evidence.confidence !== undefined && evidence.confidence < 0.7;

  return (
    <button
      type="button"
      onClick={() => onSelect(evidence)}
      aria-pressed={active}
      className={`group relative w-full overflow-hidden rounded-md border px-4 py-3.5 text-left transition-[background-color,border-color,box-shadow] duration-150 ${
        active
          ? "border-border-strong bg-surface elev-2"
          : "border-border bg-surface hover:border-border-strong hover:elev-2"
      }`}
    >
      {/*
        A rail down the selected card's leading edge, in the marker tone that is about to
        appear in the transcript. It ties the click to its result before the eye has moved.
      */}
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-0.75 transition-opacity duration-150 ${
          active ? "bg-highlight-edge opacity-100" : "opacity-0"
        }`}
      />

      <p className="text-[0.9375rem] font-medium leading-6 text-fg">
        {evidence.claim}
      </p>

      {/*
        The receipt. This is the product; it is never collapsed behind a toggle. Set in the
        display serif because it is speech being quoted, not interface copy — the change of
        voice is what stops a reader from mistaking the quote for our own wording.
      */}
      <blockquote className="mt-2.5 border-l-2 border-highlight-edge pl-3">
        <p className="font-serif text-[0.9375rem] leading-6 text-muted">
          {evidence.quote}
        </p>
      </blockquote>

      <div className="mt-3.5 flex items-center gap-2.5 text-xs">
        <SpeakerAvatar speaker={evidence.speaker} />
        <span className="font-medium text-muted">{evidence.speaker}</span>
        <span className="tabular-nums text-subtle">{timestamp(evidence.startMs)}</span>

        {lowConfidence && (
          <span
            className="inline-flex items-center gap-1 rounded-sm border border-border bg-warn-bg px-1.5 py-0.5 font-medium text-warn"
            title="Evidence resolved, but the model was unsure. Shown, not hidden."
          >
            <TriangleAlert size={11} strokeWidth={2} aria-hidden />
            low confidence
          </span>
        )}

        {/*
          Kept in the layout at all times and revealed on hover, so nothing reflows when
          the pointer arrives. Hidden from assistive tech: the button's pressed state
          already carries what this affordance is hinting at.
        */}
        <span
          aria-hidden
          className="ml-auto inline-flex items-center gap-1 text-subtle opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          <CornerDownRight size={12} strokeWidth={2} />
          Jump to moment
        </span>
      </div>
    </button>
  );
}
