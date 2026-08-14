import { SiteHeader } from "../../../components/layout/SiteHeader";
import { CallView } from "./CallView";

export default async function CallPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <SiteHeader />
      {/* 80rem is the design system's 1280px content ceiling. */}
      <main className="mx-auto w-full max-w-7xl px-6 py-10 sm:py-12">
        <CallView id={id} />
      </main>
    </>
  );
}
