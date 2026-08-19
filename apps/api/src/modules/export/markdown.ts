import type { CallNotes, Evidence } from "@convorecall/types";

function timestamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Every claim carries its quote, speaker, and timestamp inline.
 *
 * An export that drops the receipts is just another AI summary — the thing this product
 * exists not to be. The evidence has to survive leaving the app.
 */
function renderEvidence(evidence: Evidence): string {
  const low =
    evidence.confidence !== undefined && evidence.confidence < 0.7
      ? " _(low confidence)_"
      : "";
  return [
    `- **${evidence.claim}**${low}`,
    `  > “${evidence.quote}”`,
    `  > — ${evidence.speaker}, ${timestamp(evidence.startMs)}`,
  ].join("\n");
}

const EXIT_COPY: Record<string, string> = {
  shipped: "Complete — every claim verified against the recording.",
  partial: "Partial — some claims could not be verified and were removed.",
  deadline: "Stopped at budget — analysis ended before completing.",
  failed: "Failed — nothing could be verified.",
};

export function renderNotesMarkdown(notes: CallNotes): string {
  const lines: string[] = ["# Deal notes", ""];

  lines.push(`_${EXIT_COPY[notes.exitStatus] ?? notes.exitStatus}_`);
  if (notes.metadata.droppedClaims > 0) {
    lines.push(
      "",
      `> ${notes.metadata.droppedClaims} claim(s) were removed because they could not be matched to anything said on the call.`,
    );
  }
  lines.push("");

  if (notes.summary) {
    lines.push("## Summary", "", notes.summary, "");
  }

  if (notes.intent?.claim) {
    lines.push("## Intent", "", renderEvidence(notes.intent), "");
  }

  const sections: Array<[string, Evidence[]]> = [
    ["Objections", notes.objections],
    ["Next steps", notes.nextSteps],
  ];
  for (const [title, items] of sections) {
    lines.push(`## ${title}`, "");
    lines.push(
      items.length === 0
        ? "_Nothing here could be verified against the recording._"
        : items.map(renderEvidence).join("\n"),
    );
    lines.push("");
  }

  if (notes.followUpEmail) {
    lines.push("## Follow-up email", "", notes.followUpEmail, "");
  }

  lines.push(
    "---",
    "",
    `Generated ${notes.metadata.generatedAt} · prompts ${notes.metadata.promptVersion}` +
      `${notes.metadata.sttModel ? ` · stt ${notes.metadata.sttModel}` : ""}` +
      ` · model ${notes.metadata.llmModel}`,
    "",
    "Produced by ConvoRecall. Every claim above is quoted from the call.",
  );

  return lines.join("\n");
}

const EXPORT_FILENAME_PREFIX = "convorecall";

/** Filenames end up in a Content-Disposition header and on the user's disk. */
export function safeFilename(callId: string, extension: string): string {
  const safe = callId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40) || "call";
  return `${EXPORT_FILENAME_PREFIX}-${safe}.${extension}`;
}
