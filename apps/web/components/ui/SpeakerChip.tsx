import { initials } from "../../lib/format";

/**
 * Speaker identity, as an avatar the design system asks the transcript to carry.
 *
 * Deliberately monochrome. Assigning each speaker a colour would mean inventing hues
 * outside the palette, and on a four-speaker enterprise call those hues start to imply
 * something the data does not contain — who is friendly, who is a blocker. Initials
 * differentiate; the palette stays honest.
 */
export function SpeakerAvatar({ speaker }: { speaker: string }) {
  return (
    <span
      className="inline-flex size-5 shrink-0 select-none items-center justify-center rounded-full border border-border bg-raised text-[0.5625rem] font-semibold leading-none tracking-tight text-muted"
      aria-hidden
    >
      {initials(speaker)}
    </span>
  );
}

/** Avatar plus name, for a metadata row. */
export function SpeakerChip({ speaker }: { speaker: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <SpeakerAvatar speaker={speaker} />
      <span className="text-xs font-medium text-muted">{speaker}</span>
    </span>
  );
}
