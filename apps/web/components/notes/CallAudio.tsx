"use client";

import { TriangleAlert } from "lucide-react";
import { forwardRef, useState } from "react";
import { api } from "../../lib/api";

/**
 * The recording, above the transcript, so a claim can be heard and not just read.
 *
 * Native controls on purpose. A bespoke player would match the rest of the page more closely,
 * but it would also mean re-implementing keyboard access, screen-reader labelling, and scrub
 * behaviour that browsers already ship correctly — and this element is the one thing on the page
 * a user might drive without a mouse.
 */

/** Past this much disagreement, the two timelines are not the same recording. */
const DRIFT_TOLERANCE_S = 2;

export type AudioState = {
  available: boolean;
  /** True when the transcript's clock demonstrably does not match the audio's. */
  drifted: boolean;
};

export const CallAudio = forwardRef<
  HTMLAudioElement,
  {
    callId: string;
    /** End of the last transcript segment, in ms — the transcript's own idea of length. */
    transcriptEndMs: number;
    onStateChange?: (state: AudioState) => void;
    /** Fires ~4x/second while playing, with the current position in seconds. */
    onTime?: (seconds: number) => void;
  }
>(function CallAudio({ callId, transcriptEndMs, onStateChange, onTime }, ref) {
  const [missing, setMissing] = useState(false);
  const [drifted, setDrifted] = useState(false);

  return (
    <div className="border-b border-border px-4 py-3">
      {missing ? (
        <p className="text-xs leading-5 text-subtle">
          No recording is stored for this call. The transcript below is unaffected.
        </p>
      ) : (
        <>
          <audio
            ref={ref}
            src={api.audioUrl(callId)}
            controls
            preload="metadata"
            className="w-full"
            aria-label="Call recording"
            onTimeUpdate={(event) => onTime?.(event.currentTarget.currentTime)}
            onError={() => {
              setMissing(true);
              onStateChange?.({ available: false, drifted: false });
            }}
            onLoadedMetadata={(event) => {
              // The browser knows the real length; compare it with what the transcript claims.
              // A large gap means seeking to a claim's timestamp would land somewhere else.
              const audioEnd = event.currentTarget.duration;
              const gap = Math.abs(audioEnd - transcriptEndMs / 1000);
              const isDrifted = Number.isFinite(audioEnd) && gap > DRIFT_TOLERANCE_S;
              setDrifted(isDrifted);
              onStateChange?.({ available: true, drifted: isDrifted });
            }}
          />

          {drifted && (
            <p className="mt-2 flex items-start gap-1.5 text-[0.6875rem] leading-4 text-warn">
              <TriangleAlert
                size={12}
                strokeWidth={2}
                className="mt-0.5 shrink-0"
                aria-hidden
              />
              {/*
                Said plainly rather than hidden. The sample recordings are a voice rendering of
                the authored transcript and run shorter than its timestamps, so jumping to a
                claim lands near the moment rather than on it. Real uploads take their timestamps
                from the audio itself, so this never appears for them.
              */}
              This recording&rsquo;s timing does not match the transcript, so playback jumps are
              approximate. The quoted text is still exact.
            </p>
          )}
        </>
      )}
    </div>
  );
});
