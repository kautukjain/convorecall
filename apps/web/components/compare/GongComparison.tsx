import Link from "next/link";
import { Check, Minus, ArrowRight } from "lucide-react";
import {
  COMPARE_META,
  COMPARE_ROWS,
  CONVRECALL_WINS,
  type CompareMark,
} from "../../lib/gong-comparison";
import { SectionLabel } from "../ui/SectionLabel";

function ConvoRecallName({ className = "" }: { className?: string }) {
  return (
    <span
      className={`font-serif font-medium tracking-[-0.01em] text-fg ${className}`}
    >
      ConvoRecall
    </span>
  );
}

function MarkIcon({ mark }: { mark: CompareMark }) {
  const wrap =
    mark === "yes"
      ? "bg-brand-surface text-brand"
      : mark === "partial"
        ? "bg-warn-bg text-warn"
        : "bg-raised text-subtle";
  const Icon = mark === "yes" ? Check : Minus;
  return (
    <span
      className={`mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full ${wrap}`}
    >
      <Icon size={16} strokeWidth={3} aria-hidden />
    </span>
  );
}

function markLabel(mark: CompareMark): string {
  if (mark === "yes") return "Yes";
  if (mark === "partial") return "Partial";
  return "No";
}

function GongMark() {
  return (
    <span className="inline-flex h-10 items-center rounded-xl border border-border bg-raised px-3 text-sm font-semibold tracking-tight text-fg elev-1">
      Gong
    </span>
  );
}

/**
 * Marketing comparison only. Isolated from calls, notes, and share so those routes
 * cannot import this module by accident.
 */
export function GongComparison() {
  return (
    <article>
      <ConvoRecallName className="text-2xl sm:text-3xl" />
      <p className="label-eyebrow mt-8 flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-brand" aria-hidden />
        {COMPARE_META.eyebrow}
      </p>
      <h1 className="text-display mt-4 text-4xl text-fg sm:text-[2.875rem]">
        {COMPARE_META.title}
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
        {COMPARE_META.lede}
      </p>

      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-5 elev-compare">
          <GongMark />
          <p className="mt-4 font-serif text-2xl text-fg">{COMPARE_META.gongPrice}</p>
          <p className="mt-1 text-xs leading-5 text-subtle">
            {COMPARE_META.gongPriceHint}
          </p>
        </div>
        <div className="rounded-xl border border-brand-border bg-brand-surface p-5 elev-compare-brand">
          <ConvoRecallName className="text-lg" />
          <p className="mt-4 font-serif text-2xl text-fg">{COMPARE_META.ourPrice}</p>
          <p className="mt-1 text-xs leading-5 text-subtle">
            {COMPARE_META.ourPriceHint}
          </p>
        </div>
      </div>

      <section className="mt-14" aria-labelledby="compare-table-heading">
        <SectionLabel>Features</SectionLabel>
        <h2 id="compare-table-heading" className="sr-only">
          Feature comparison
        </h2>
        <div className="overflow-hidden rounded-xl border border-border bg-surface elev-compare">
          <div className="overflow-x-auto">
            <table className="w-full min-w-160 text-left text-sm">
              <caption className="sr-only">
                ConvoRecall compared with Gong on price, notes, evidence, and platform
                features
              </caption>
              <thead>
                <tr className="border-b border-border bg-raised text-xs text-subtle">
                  <th scope="col" className="px-4 py-3.5 font-medium">
                    Capability
                  </th>
                  <th scope="col" className="px-4 py-3.5 font-medium">
                    <span className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-2.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-fg">
                      Gong
                    </span>
                  </th>
                  <th
                    scope="col"
                    className="bg-brand-surface px-4 py-3.5 font-medium"
                  >
                    <span className="inline-flex items-center">
                      <ConvoRecallName className="text-[0.9375rem]" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-border last:border-b-0"
                  >
                    <th
                      scope="row"
                      className="px-4 py-4 align-top font-medium text-fg"
                    >
                      {row.feature}
                    </th>
                    <td className="px-4 py-4 align-top text-muted">
                      <span className="flex gap-2.5">
                        <MarkIcon mark={row.gong.mark} />
                        <span className="leading-6">
                          <span className="sr-only">{markLabel(row.gong.mark)}. </span>
                          {row.gong.note}
                        </span>
                      </span>
                    </td>
                    <td className="bg-brand-surface/80 px-4 py-4 align-top text-fg">
                      <span className="flex gap-2.5">
                        <MarkIcon mark={row.convorecall.mark} />
                        <span className="leading-6">
                          <span className="sr-only">
                            {markLabel(row.convorecall.mark)}.{" "}
                          </span>
                          {row.convorecall.note}
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mt-14">
        <SectionLabel>Where ConvoRecall wins</SectionLabel>
        <ul className="space-y-3 rounded-xl border border-brand-border bg-brand-surface p-5 text-sm leading-6 text-fg elev-compare-brand">
          {CONVRECALL_WINS.map((line) => (
            <li key={line} className="flex gap-2.5">
              <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-surface text-brand">
                <Check size={16} strokeWidth={3} aria-hidden />
              </span>
              {line}
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-10 text-xs leading-5 text-subtle">
        Gong is a trademark of Gong.io Ltd. This page is an independent comparison, not
        affiliated with Gong. Seat price is the figure we use in the demo script, not a
        quote from Gong sales.
      </p>

      <div className="mt-10 flex flex-wrap items-center gap-4 border-t border-border pt-8">
        <Link
          href="/"
          className="inline-flex h-9 items-center gap-2 rounded-md border border-transparent bg-accent px-3 text-sm font-medium text-accent-fg elev-1 hover:opacity-90"
        >
          Try a sample call
          <ArrowRight size={14} strokeWidth={2} aria-hidden />
        </Link>
      </div>
    </article>
  );
}
