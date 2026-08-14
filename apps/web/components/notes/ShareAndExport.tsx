"use client";

import { Braces, FileDown, Link2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { ApiError, api, type Share } from "../../lib/api";
import { Button } from "../ui/Button";
import { CopyButton } from "../ui/CopyButton";

type Busy = "md" | "json" | "share" | null;

/**
 * The three ways notes leave the app. All three endpoints already existed; nothing in the UI
 * called them, so `docs/Demo.md`'s "flash the export, then the share link" beat needed a
 * terminal and a pasted URL in front of an audience.
 *
 * The share link is deliberately not a one-click-and-done affordance. It is a public,
 * unauthenticated URL to a customer's call — `docs/API.md` calls it the highest-risk surface
 * in the product, and its hardening (TTL policy, revocation, per-token limits) is still
 * deferred. So the link is shown with what it actually is, rather than quietly copied to the
 * clipboard as if it were a normal share.
 */
export function ShareAndExport({ callId }: { callId: string }) {
  const [busy, setBusy] = useState<Busy>(null);
  const [share, setShare] = useState<Share | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(what: Busy, work: () => Promise<void>) {
    setBusy(what);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.problem.detail
          : "Could not reach the API. Is it running on port 3001?",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => void run("md", () => api.download(callId, "md"))}
          loading={busy === "md"}
          disabled={busy !== null}
          icon={<FileDown size={13} strokeWidth={2} aria-hidden />}
        >
          Markdown
        </Button>
        <Button
          size="sm"
          onClick={() => void run("json", () => api.download(callId, "json"))}
          loading={busy === "json"}
          disabled={busy !== null}
          icon={<Braces size={13} strokeWidth={2} aria-hidden />}
        >
          JSON
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={() =>
            void run("share", async () => setShare(await api.createShare(callId)))
          }
          loading={busy === "share"}
          disabled={busy !== null}
          icon={<Link2 size={13} strokeWidth={2} aria-hidden />}
        >
          {share ? "New share link" : "Share link"}
        </Button>
      </div>

      {share && (
        <div className="w-full max-w-md rounded-md border border-border bg-raised px-3 py-2.5 sm:w-auto">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={share.url}
              aria-label="Public share link"
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 truncate bg-transparent font-mono text-xs text-fg outline-none sm:w-72"
            />
            <CopyButton text={share.url} />
          </div>
          {/* What it is, in plain words, at the moment it is created. */}
          <p className="mt-1.5 text-[0.6875rem] leading-4 text-subtle">
            Public and read-only. Anyone with the link can read these notes without signing
            in.{" "}
            {share.expiresAt
              ? `Expires ${new Date(share.expiresAt).toISOString().slice(0, 10)}.`
              : "It does not expire."}
          </p>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="inline-flex items-start gap-1.5 text-xs leading-5 text-danger"
        >
          <TriangleAlert
            size={13}
            strokeWidth={2}
            className="mt-0.5 shrink-0"
            aria-hidden
          />
          {error}
        </p>
      )}
    </div>
  );
}
