import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { INestApplication } from "@nestjs/common";
import { PROBLEM_CODES } from "../common/problem.js";

/**
 * Interactive API reference at `/api/v1/docs` (.cursor/rules/backend.mdc).
 *
 * `docs/API.md` remains the normative contract (ADR-004); this is generated from the
 * running application, so the two can be compared and a drift between them is a bug in
 * one of them rather than a matter of opinion.
 */
export function setupOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle("ConvoRecall")
    .setDescription(
      [
        "Deal notes with receipts from any call.",
        "",
        "Every claim in a notes payload carries a quote that resolves to a real span of",
        "the transcript. Claims that cannot be resolved are dropped and counted, never",
        "softened — see `docs/Evidence-System.md`.",
        "",
        "**Errors** are RFC 9457 `application/problem+json`. The `code` field is the",
        "stable machine-readable value; `title` and `detail` are human-facing.",
        "",
        "**Auth** is not implemented. Every endpoint is unauthenticated and",
        "single-tenant — acceptable for local and self-hosted single-user operation, not",
        "for a shared deployment.",
      ].join("\n"),
    )
    .setVersion("0.1.0")
    .setLicense("MIT", "https://opensource.org/licenses/MIT")
    .addTag("calls", "Ingest a recording and read its analysis")
    .addTag("transcript", "Timed, speaker-labelled transcript")
    .addTag("notes", "Gated notes payload")
    .addTag("export", "Markdown and JSON download")
    .addTag("share", "Public read-only links")
    .addTag("health", "Liveness")
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // Document the error shape once, centrally, rather than repeating it per route.
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.schemas["Problem"] = {
    type: "object",
    description: "RFC 9457 problem detail.",
    properties: {
      type: { type: "string", format: "uri" },
      title: { type: "string" },
      status: { type: "integer" },
      detail: { type: "string" },
      code: {
        type: "string",
        enum: Object.keys(PROBLEM_CODES),
        description: "Stable machine-readable error code.",
      },
    },
    required: ["type", "title", "status", "detail", "code"],
  };

  SwaggerModule.setup("api/v1/docs", app, document, {
    jsonDocumentUrl: "api/v1/docs.json",
    customSiteTitle: "ConvoRecall API",
    swaggerOptions: { defaultModelsExpandDepth: 1, tryItOutEnabled: true },
  });
}
