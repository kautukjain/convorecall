import { Link2Off } from "lucide-react";
import type { Metadata } from "next";
import type { Evidence } from "@opengong/types";
import { API_URL } from "../../../lib/api";
import { absoluteDate, timestamp } from "../../../lib/format";
import { ExitBadge } from "../../../components/notes/ExitBadge";
import { SiteHeader } from "../../../components/layout/SiteHeader";
import { Panel } from "../../../components/ui/Panel";
import { SectionLabel } from "../../../components/ui/SectionLabel";
import { SpeakerAvatar } from "../../../components/ui/SpeakerChip";

// A shared link points at a customer's call. It must never be indexed.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type PublicNotes = {
  exitStatus: "shipped" | "partial" | "failed" | "deadline";
  summary: string;
  intent: Evidence | null;
  objections: Evidence[];
  nextSteps: Evidence[];
  followUpEmail: string;
  metadata: { droppedClaims: number; generatedAt: string };
};

/**
 * The same claim-and-quote pairing as EvidenceCard, minus the interaction: there is no
 * transcript on a shared page to jump to. It is styled to match anyway, so a recipient who
 * later sees the app recognises what they were sent.
 */
function Receipt({ evidence }: { evidence: Evidence }) {
  return (
    <li className="rounded-md border border-border bg-surface px-4 py-3.5 elev-1">
      <p className="text-[0.9375rem] font-medium leading-6 text-fg">{evidence.claim}</p>
      <blockquote className="mt-2.5 border-l-2 border-highlight-edge pl-3">
        <p className="font-serif text-[0.9375rem] leading-6 text-muted">
          {evidence.quote}
        </p>
      </blockquote>
      <div className="mt-3.5 flex items-center gap-2.5 text-xs">
        <SpeakerAvatar speaker={evidence.speaker} />
        <span className="font-medium text-muted">{evidence.speaker}</span>
        <span className="tabular-nums text-subtle">{timestamp(evidence.startMs)}</span>
      </div>
    </li>
  );
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const response = await fetch(`${API_URL}/api/v1/share/${token}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as {
      detail?: string;
    } | null;
    return (
      <>
        <SiteHeader />
        <main className="mx-auto w-full max-w-md px-6 py-24">
          <Panel>
            <div className="px-6 py-8 text-center">
              <Link2Off
                size={20}
                strokeWidth={1.75}
                className="mx-auto text-subtle"
                aria-hidden
              />
              <h1 className="text-display mt-4 text-2xl text-fg">
                This link isn&rsquo;t available
              </h1>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-muted">
                {problem?.detail ?? "The link may have expired or been revoked."}
              </p>
            </div>
          </Panel>
        </main>
      </>
    );
  }

  const notes = (await response.json()) as PublicNotes;
  const sections: Array<[string, Evidence[]]> = [
    ["Objections", notes.objections],
    ["Next steps", notes.nextSteps],
  ];

  return (
    <>
      <SiteHeader />

      {/* Narrower than the app: this is a document to read, not a workspace. */}
      <main className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-border pb-6">
          <div>
            <h1 className="text-display text-3xl text-fg">Deal notes</h1>
            <p className="mt-1.5 text-sm leading-6 text-muted">
              Every claim below is quoted from the call.
            </p>
          </div>
          <ExitBadge
            status={notes.exitStatus}
            droppedClaims={notes.metadata.droppedClaims}
          />
        </header>

        {notes.summary && (
          <section className="mt-10">
            <SectionLabel>Summary</SectionLabel>
            {/*
              Capped measure. The receipts below can use the full column because each is a
              sentence or two, but the summary is a paragraph, and a paragraph set 95
              characters wide loses the reader's place on every line return.
            */}
            <p className="max-w-prose font-serif text-base leading-7 text-fg sm:text-lg sm:leading-8">
              {notes.summary}
            </p>
          </section>
        )}

        {notes.intent?.claim && (
          <section className="mt-10">
            <SectionLabel>Intent</SectionLabel>
            <ul>
              <Receipt evidence={notes.intent} />
            </ul>
          </section>
        )}

        {sections.map(([title, items]) => (
          <section key={title} className="mt-10">
            <SectionLabel count={items.length}>{title}</SectionLabel>
            {items.length === 0 ? (
              <p className="rounded-md border border-dashed border-border bg-raised px-4 py-3.5 text-sm leading-6 text-subtle">
                Nothing here could be verified against the recording.
              </p>
            ) : (
              <ul className="space-y-3">
                {items.map((evidence, i) => (
                  <Receipt key={`${title}-${i}`} evidence={evidence} />
                ))}
              </ul>
            )}
          </section>
        ))}

        <footer className="mt-14 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-5 text-xs text-subtle">
          <span>Produced by ConvoRecall</span>
          <span aria-hidden>&middot;</span>
          <time dateTime={notes.metadata.generatedAt}>
            {absoluteDate(notes.metadata.generatedAt)}
          </time>
        </footer>
      </main>
    </>
  );
}
