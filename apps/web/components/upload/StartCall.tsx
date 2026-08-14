"use client";

import { ArrowRight, Link2, TriangleAlert, UploadCloud, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ApiError, api } from "../../lib/api";
import { Button } from "../ui/Button";
import { Panel } from "../ui/Panel";

// Ordered as a deal progresses, so the sample set reads as one story.
const FIXTURES = [
  { name: "discovery-call", label: "First discovery", speakers: 2 },
  { name: "demo-call", label: "Product demo", speakers: 2 },
  { name: "objection-call", label: "Pricing objections", speakers: 2 },
  { name: "enterprise-call", label: "Multi-stakeholder", speakers: 4 },
  { name: "support-call", label: "Support to expansion", speakers: 3 },
];

/** A labelled band inside the start panel. Dividers separate the three ways in. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-4 sm:px-5">
      <div className="mb-2.5 flex items-baseline gap-2">
        <h2 className="label-eyebrow">{label}</h2>
        {hint && <span className="text-xs text-subtle">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function StartCall() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  // Drag events fire for every child element; a depth count is what keeps the highlight
  // from flickering as the pointer crosses the label's inner text.
  const dragDepth = useRef(0);

  async function start(work: () => Promise<{ id: string }>, label: string) {
    setBusy(label);
    setError(null);
    try {
      const { id } = await work();
      router.push(`/calls/${id}`);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.problem.detail
          : "Could not reach the API. Is it running on port 3001?",
      );
      setBusy(null);
    }
  }

  function accept(file: File | undefined) {
    if (!file) return;
    // The picker enforces this already; a drop does not.
    if (file.type && !file.type.startsWith("audio/")) {
      setError(`${file.name} is not an audio file. Upload mp3, wav, m4a or webm.`);
      return;
    }
    void start(() => api.upload(file), file.name);
  }

  const uploading = busy !== null;

  return (
    <div className="space-y-4">
      <Panel className="divide-y divide-border">
        <Field label="Upload a recording" hint="mp3, wav, m4a or webm">
          <label
            onDragEnter={(event) => {
              event.preventDefault();
              dragDepth.current += 1;
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => {
              dragDepth.current -= 1;
              if (dragDepth.current <= 0) setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              dragDepth.current = 0;
              setDragging(false);
              accept(event.dataTransfer.files[0]);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed px-6 py-9 text-center transition-[background-color,border-color] duration-150 ${
              dragging
                ? "border-brand-border bg-brand-surface"
                : "border-border-strong bg-raised hover:bg-surface"
            } ${uploading ? "pointer-events-none opacity-50" : ""}`}
          >
            <input
              type="file"
              accept="audio/*"
              className="sr-only"
              onChange={(event) => accept(event.target.files?.[0])}
            />
            <UploadCloud
              size={20}
              strokeWidth={1.75}
              className={dragging ? "text-brand" : "text-subtle"}
              aria-hidden
            />
            <span className="text-sm font-medium text-fg">
              {uploading
                ? `Uploading ${busy}`
                : dragging
                  ? "Drop to start"
                  : "Drop a file, or click to choose"}
            </span>
            <span className="text-xs text-subtle">
              The audio stays on the machine running the API.
            </span>
          </label>
        </Field>

        <Field label="Or paste a link">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = url.trim();
              if (trimmed) void start(() => api.createFromUrl(trimmed), trimmed);
            }}
          >
            <div className="relative min-w-0 flex-1">
              <Link2
                size={14}
                strokeWidth={2}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
                aria-hidden
              />
              <input
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/call.mp3"
                aria-label="Recording URL"
                disabled={uploading}
                className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-3 text-sm text-fg transition-[border-color,background-color] duration-150 placeholder:text-subtle hover:border-border-strong focus:border-border-strong disabled:opacity-50"
              />
            </div>
            <Button
              type="submit"
              variant="primary"
              disabled={url.trim().length === 0}
              loading={uploading && busy === url.trim()}
              icon={<ArrowRight size={14} strokeWidth={2} aria-hidden />}
            >
              Fetch
            </Button>
          </form>
        </Field>

        <Field label="Or run a sample call" hint="No keys needed">
          <ul className="-mx-1.5">
            {FIXTURES.map((fixture) => {
              const active = busy === fixture.label;
              return (
                <li key={fixture.name}>
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() =>
                      void start(
                        () => api.createFromFixture(fixture.name),
                        fixture.label,
                      )
                    }
                    className="group flex w-full items-center gap-3 rounded-md px-1.5 py-2 text-left transition-colors duration-150 hover:bg-raised disabled:pointer-events-none disabled:opacity-45"
                  >
                    <span className="truncate text-sm text-fg">{fixture.label}</span>
                    <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs tabular-nums text-subtle">
                      <Users size={11} strokeWidth={2} aria-hidden />
                      {fixture.speakers}
                    </span>
                    <ArrowRight
                      size={13}
                      strokeWidth={2}
                      aria-hidden
                      className={`shrink-0 transition-[opacity,transform] duration-150 ${
                        active
                          ? "text-fg opacity-100"
                          : "text-subtle opacity-0 group-hover:translate-x-0.5 group-hover:opacity-100"
                      }`}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </Field>
      </Panel>

      {error && (
        <div
          role="alert"
          className="flex gap-2.5 rounded-md border border-danger-border bg-danger-bg px-4 py-3"
        >
          <TriangleAlert
            size={15}
            strokeWidth={2}
            className="mt-0.5 shrink-0 text-danger"
            aria-hidden
          />
          <p className="text-sm leading-6 text-danger">{error}</p>
        </div>
      )}
    </div>
  );
}
