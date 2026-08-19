import type { CallNotes, JobStatus, TranscriptSegment } from "@convorecall/types";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const V1 = `${API_URL}/api/v1`;

export type CallSummary = {
  id: string;
  state: JobStatus;
  source: string;
  durationMs: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  exitStatus: string | null;
  budget: { tokensUsed: number; tokenBudget: number; deadlineAt: string } | null;
  failure: { reason: string; message: string } | null;
};

export type Transcript = {
  callId: string;
  speakers: string[];
  segments: TranscriptSegment[];
};

export type Share = {
  token: string;
  /** Absolute URL on the web app, built by the API from WEB_URL. */
  url: string;
  expiresAt: string | null;
  createdAt: string;
};

export type Problem = { code: string; title: string; detail: string };

export class ApiError extends Error {
  readonly problem: Problem;
  constructor(problem: Problem) {
    super(problem.detail);
    this.problem = problem;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${V1}${path}`, {
    ...init,
    cache: "no-store",
  });

  if (!response.ok) {
    // Errors are problem+json (ADR-010); surface `detail`, never a raw status.
    let problem: Problem = {
      code: "internal_error",
      title: "Something went wrong",
      detail: `Request failed (${response.status}).`,
    };
    try {
      problem = { ...problem, ...(await response.json()) };
    } catch {
      /* keep the fallback */
    }
    throw new ApiError(problem);
  }

  return (await response.json()) as T;
}

export const TERMINAL_STATES = ["shipped", "partial", "failed", "deadline"];

export function isTerminal(state: string): boolean {
  return TERMINAL_STATES.includes(state);
}

export const api = {
  createFromFixture: (fixture: string) =>
    request<{ id: string }>("/calls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fixture }),
    }),

  createFromUrl: (url: string) =>
    request<{ id: string }>("/calls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    }),

  upload: (file: File) => {
    const body = new FormData();
    body.set("file", file);
    return request<{ id: string }>("/calls", { method: "POST", body });
  },

  getCall: (id: string) => request<CallSummary>(`/calls/${id}`),
  getTranscript: (id: string) => request<Transcript>(`/calls/${id}/transcript`),
  getNotes: (id: string) => request<CallNotes>(`/calls/${id}/notes`),
  eventsUrl: (id: string) => `${V1}/calls/${id}/events`,

  /**
   * Streamed by the API with range support, so the browser can seek without downloading the
   * whole recording. Used directly as an <audio src>, which is why it is a URL and not a fetch.
   */
  audioUrl: (id: string) => `${V1}/calls/${id}/audio`,

  /** Mints a public read-only link. Rate limited to 30/hour/IP by the API. */
  createShare: (id: string) =>
    request<Share>(`/calls/${id}/share`, { method: "POST" }),

  /**
   * Downloads an export.
   *
   * Fetched rather than linked. The API sets `content-disposition: attachment`, so a plain
   * anchor would work — but it is on another origin, where the `download` attribute is
   * ignored and a failure navigates the user to a raw problem+json page instead of telling
   * them what went wrong. Going through `fetch` keeps errors in the same shape as every
   * other call and keeps the reader on the page.
   */
  download: async (id: string, format: "md" | "json"): Promise<void> => {
    const response = await fetch(`${V1}/calls/${id}/export.${format}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      let problem: Problem = {
        code: "internal_error",
        title: "Export failed",
        detail: `Could not export this call (${response.status}).`,
      };
      try {
        problem = { ...problem, ...(await response.json()) };
      } catch {
        /* keep the fallback */
      }
      throw new ApiError(problem);
    }

    // Honour the filename the API chose; it already sanitizes it.
    const disposition = response.headers.get("content-disposition") ?? "";
    const named = /filename="([^"]+)"/.exec(disposition)?.[1];

    const href = URL.createObjectURL(await response.blob());
    try {
      const link = document.createElement("a");
      link.href = href;
      link.download = named ?? `call-${id}.${format}`;
      link.click();
    } finally {
      // Same-origin blob URL, so `download` applies. Revoke either way.
      URL.revokeObjectURL(href);
    }
  },
};
