/**
 * RFC 9457 problem+json (ADR-010). The `code` is the stable machine-readable field;
 * `title` and `detail` are human-facing and may change.
 *
 * Codes and their statuses are the contract in docs/API.md. Adding one here without
 * adding it there is a bug.
 */
export const PROBLEM_CODES = {
  invalid_request: { status: 400, title: "Invalid request" },
  unsupported_media_type: { status: 415, title: "Unsupported media type" },
  upload_too_large: { status: 413, title: "Upload too large" },
  duration_exceeded: { status: 422, title: "Duration exceeded" },
  call_not_found: { status: 404, title: "Call not found" },
  transcript_not_ready: { status: 409, title: "Transcript not ready" },
  audio_not_available: { status: 404, title: "Audio not available" },
  notes_not_ready: { status: 409, title: "Notes not ready" },
  share_not_found: { status: 404, title: "Share not found" },
  share_expired: { status: 410, title: "Share expired" },
  rate_limited: { status: 429, title: "Rate limited" },
  internal_error: { status: 500, title: "Internal error" },
} as const;

export type ProblemCode = keyof typeof PROBLEM_CODES;

export type ProblemBody = {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: ProblemCode;
};

/**
 * Domain exception. Carries an operator-facing `cause` that is logged but never
 * serialized — clients get `detail`, operators get the rest (docs/API.md).
 */
export class ProblemException extends Error {
  readonly code: ProblemCode;
  readonly status: number;
  readonly detail: string;
  readonly operatorDetail?: string;

  constructor(code: ProblemCode, detail: string, operatorDetail?: string) {
    super(`${code}: ${detail}`);
    this.name = "ProblemException";
    this.code = code;
    this.status = PROBLEM_CODES[code].status;
    this.detail = detail;
    this.operatorDetail = operatorDetail;
  }

  toBody(): ProblemBody {
    return {
      type: `https://opengong.dev/problems/${this.code.replace(/_/g, "-")}`,
      title: PROBLEM_CODES[this.code].title,
      status: this.status,
      detail: this.detail,
      code: this.code,
    };
  }
}
