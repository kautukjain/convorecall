import { z } from "zod";

/**
 * The three ingest forms from docs/API.md. Exactly one must be present — a body naming
 * both a url and a fixture is ambiguous, not a convenience.
 */
export const CreateCallBodySchema = z
  .object({
    url: z.string().url().optional(),
    fixture: z
      .string()
      .regex(/^[a-z0-9-]{1,64}$/, "fixture must be a slug")
      .optional(),
  })
  .refine((body) => !(body.url && body.fixture), {
    message: "Provide either url or fixture, not both",
  });

export type CreateCallBody = z.infer<typeof CreateCallBodySchema>;

export const CallIdParamSchema = z.uuid("call id must be a UUID");
