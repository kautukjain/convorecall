"use client";

import { useEffect, useRef } from "react";
import type { TranscriptSegment } from "@opengong/types";
import { timestamp } from "../../lib/format";
import { SpeakerAvatar } from "../ui/SpeakerChip";

/**
 * The transcript is the product's centrepiece, so it is typeset rather than dumped: a line
 * number gutter for reference, timestamps in tabular figures so they form a straight
 * column, and a speaker shown once per turn instead of once per line. Repeating "Rep" down
 * forty consecutive rows is noise that hides the thing a reader is scanning for.
 */
export function TranscriptPanel({
  segments,
  highlighted,
  playingId = null,
}: {
  segments: TranscriptSegment[];
  highlighted: string[];
  /** The line the recording is on right now, or null when nothing is playing. */
  playingId?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const firstHit = highlighted[0];

  // Scroll the matched span into view when the selection changes. Without this the
  // receipt is technically present and practically invisible.
  useEffect(() => {
    if (!firstHit || !containerRef.current) return;
    containerRef.current
      .querySelector(`[data-segment="${firstHit}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [firstHit]);

  // Follow the recording. `nearest` rather than `center`: this fires on its own every few
  // seconds, and yanking the reader to the middle of the panel each time would make the
  // transcript unreadable while it plays.
  useEffect(() => {
    if (!playingId || !containerRef.current) return;
    containerRef.current
      .querySelector(`[data-segment="${playingId}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [playingId]);

  if (segments.length === 0) {
    return (
      <p className="px-4 py-6 text-sm leading-6 text-subtle">
        The transcript appears here once transcription finishes.
      </p>
    );
  }

  const hits = new Set(highlighted);

  return (
    <div
      ref={containerRef}
      className="scroll-quiet max-h-[calc(100vh-13rem)] overflow-y-auto overscroll-contain px-2 py-3"
      aria-label="Call transcript"
      tabIndex={0}
    >
      <ol>
        {segments.map((segment, i) => {
          const hit = hits.has(segment.id);
          const playing = segment.id === playingId;
          const startsTurn = i === 0 || segments[i - 1]?.speaker !== segment.speaker;

          return (
            <li key={segment.id} data-segment={segment.id} className="scroll-mt-8">
              {startsTurn && (
                <div
                  className={`flex items-center gap-2 px-2 pb-1.5 ${i === 0 ? "" : "pt-4"}`}
                >
                  <SpeakerAvatar speaker={segment.speaker} />
                  <span className="text-xs font-medium text-fg">{segment.speaker}</span>
                </div>
              )}

              <div
                // One or the other, never both: a cited line that is also playing keeps the
                // marker, because the citation is what the reader asked to see.
                className={`grid grid-cols-[1.5rem_2.75rem_1fr] items-baseline gap-3 rounded-sm px-2 py-1 ${
                  hit ? "evidence-hit" : playing ? "now-playing" : ""
                }`}
                aria-current={playing ? "true" : undefined}
              >
                {/*
                  Position in the list, not `segment.index` — the API renumbers segments
                  from zero, and a line number gutter that starts at 0 is a line number
                  gutter nobody can read a call back from.
                */}
                <span
                  className="select-none text-right text-[0.625rem] leading-6 tabular-nums text-subtle"
                  aria-hidden
                >
                  {i + 1}
                </span>
                <span className="text-[0.6875rem] leading-6 tabular-nums text-subtle">
                  {timestamp(segment.startMs)}
                </span>
                <p className="text-sm leading-6 text-fg">{segment.text}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
