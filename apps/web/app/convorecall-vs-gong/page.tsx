import type { Metadata } from "next";
import { SiteHeader } from "../../components/layout/SiteHeader";
import { GongComparison } from "../../components/compare/GongComparison";

export const metadata: Metadata = {
  title: "ConvoRecall vs Gong",
  description:
    "Gong’s job — what happened, what they pushed back on, what’s next — with receipts. MIT, no seat license.",
};

export default function ConvoRecallVsGongPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-6 py-14 sm:py-20">
        <GongComparison />
      </main>
    </>
  );
}
