import { Controller, Get, Param } from "@nestjs/common";
import { CallNotesSchema } from "@opengong/validators";
import type { CallNotes } from "@opengong/types";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ProblemException } from "../../common/problem.js";
import { CallIdParamSchema } from "../calls/dto/create-call.dto.js";
import { NotesRepository } from "./notes.repository.js";

@ApiTags("notes")
@Controller("calls")
export class NotesController {
  constructor(private readonly notes: NotesRepository) {}

  /**
   * Gated notes. Available for `partial` and `deadline` as well as `shipped` —
   * partial content is the point of those states (docs/API.md).
   */
  @ApiOperation({
    summary: "Gated notes",
    description:
      "Available for `partial` and `deadline` as well as `shipped` — partial content " +
      "is the point of those states. Every claim carries a resolved transcript span.",
  })
  @ApiResponse({ status: 200, description: "Notes payload." })
  @ApiResponse({ status: 409, description: "notes_not_ready" })
  @Get(":id/notes")
  async findOne(@Param("id") id: string): Promise<CallNotes> {
    const parsed = CallIdParamSchema.safeParse(id);
    if (!parsed.success) {
      throw new ProblemException("call_not_found", "No call with that id.");
    }

    const row = await this.notes.findForCall(parsed.data);
    if (!row) {
      throw new ProblemException(
        "notes_not_ready",
        "Analysis has not completed for this call.",
      );
    }

    // Validated on read as well as write: JSON storage must not become untyped
    // storage (docs/Database.md).
    const validated = CallNotesSchema.safeParse(row.payload);
    if (!validated.success) {
      throw new ProblemException(
        "internal_error",
        "Stored notes are unreadable.",
        validated.error.issues.map((i) => i.message).join("; "),
      );
    }
    return validated.data as CallNotes;
  }
}
