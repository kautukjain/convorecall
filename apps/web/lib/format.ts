/**
 * Display formatting shared by the notes, transcript, and share screens. These were three
 * identical copies of `timestamp` before; a timestamp that renders differently on the
 * share page than in the app is the kind of bug nobody files and everybody notices.
 */

/** `m:ss` for a position within a call. Calls long enough to need hours are out of scope. */
export function timestamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Up to two letters for a speaker chip. Handles both shapes the transcript produces —
 * a name ("Dana Whitfield") and a diarised label ("Speaker 2") — and falls back to a
 * single character rather than rendering an empty circle.
 */
export function initials(speaker: string): string {
  const words = speaker.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  const last = words[words.length - 1];
  if (first === undefined || last === undefined) return "?";
  // "Speaker 2" reads better as "S2" than as "SP".
  if (words.length === 2 && /^\d+$/.test(last)) {
    return `${first.slice(0, 1)}${last}`.toUpperCase();
  }
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  return `${first.slice(0, 1)}${last.slice(0, 1)}`.toUpperCase();
}

/**
 * An ISO timestamp as something a reader can place. Fixed locale and UTC so the server
 * render and the client hydration agree — a date that differs between the two is a
 * hydration error, and this string appears on a server-rendered share page.
 */
export function absoluteDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}
