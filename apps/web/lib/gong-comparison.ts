/**
 * Copy for /convorecall-vs-gong. Only capabilities ConvoRecall ships today.
 *
 * Gong notes are the public product surface, not a scrape. Price is the figure in
 * docs/Demo.md (~$1,400/seat); Gong sells enterprise contracts, so quotes vary.
 */

export type CompareMark = "yes" | "no" | "partial";

export type CompareCell = {
  mark: CompareMark;
  note: string;
};

export type CompareRow = {
  id: string;
  feature: string;
  gong: CompareCell;
  convorecall: CompareCell;
};

export const COMPARE_META = {
  title: "",
  eyebrow: "Same job. Receipts.",
  lede: "What was said. What backs it up. What’s next. ConvoRecall ships that as notes you can click and prove — MIT licensed, no seat fee.",
  gongPrice: "About $1,400 / seat / year",
  gongPriceHint: "Enterprise contract; published seat figures vary.",
  ourPrice: "Free",
  ourPriceHint: "MIT. Run it locally. No seat license.",
} as const;

export const COMPARE_ROWS: CompareRow[] = [
  {
    id: "price",
    feature: "Price",
    gong: {
      mark: "no",
      note: "About $1,400 per seat per year, sold as an enterprise contract.",
    },
    convorecall: {
      mark: "yes",
      note: "Free. MIT license. Clone and run.",
    },
  },
  {
    id: "license",
    feature: "License",
    gong: { mark: "no", note: "Proprietary SaaS." },
    convorecall: { mark: "yes", note: "MIT. Public-ready source." },
  },
  {
    id: "setup",
    feature: "Time to first notes",
    gong: { mark: "partial", note: "Sales cycle, procurement, IT." },
    convorecall: {
      mark: "yes",
      note: "Sample calls in about five minutes. No key required for fixtures.",
    },
  },
  {
    id: "transcript",
    feature: "Diarized transcript",
    gong: { mark: "yes", note: "Speakers on recorded calls." },
    convorecall: {
      mark: "yes",
      note: "PyAI Hear. Timestamped segments with speaker labels.",
    },
  },
  {
    id: "notes",
    feature: "Deal notes",
    gong: { mark: "yes", note: "Revenue intelligence summaries." },
    convorecall: {
      mark: "yes",
      note: "Summary, intent, objections, next steps, follow-up email.",
    },
  },
  {
    id: "evidence",
    feature: "Unevidenced claims",
    gong: {
      mark: "partial",
      note: "Coaching and snippets. Not a hard drop of unmatched claims.",
    },
    convorecall: {
      mark: "yes",
      note: "Schema gate, then evidence gate. No quote, no claim. Drop count is shown.",
    },
  },
  {
    id: "click-through",
    feature: "Click a claim, hear the line",
    gong: { mark: "yes", note: "Jump to the moment in the recording." },
    convorecall: {
      mark: "yes",
      note: "Claim → transcript span and audio seek.",
    },
  },
  {
    id: "export",
    feature: "Export",
    gong: { mark: "yes", note: "Platform exports." },
    convorecall: {
      mark: "yes",
      note: "Markdown and JSON. Quotes and timestamps stay in the file.",
    },
  },
  {
    id: "share",
    feature: "Share notes",
    gong: { mark: "yes", note: "Inside the workspace, with seats." },
    convorecall: {
      mark: "yes",
      note: "Read-only link. No login. Not indexed.",
    },
  },
];

export const CONVRECALL_WINS = [
  "The same job on a call: what happened, what they pushed back on, what is next.",
  "Every shipped claim has a transcript quote. Unmatched claims are dropped, not dressed up.",
  "MIT, no seat, five-minute sample path. Receipts survive export and share.",
] as const;
