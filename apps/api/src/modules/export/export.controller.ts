import { Controller, Get, Header, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { CallNotesSchema } from "@opengong/validators";
import type { CallNotes } from "@opengong/types";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ProblemException } from "../../common/problem.js";
import { CallIdParamSchema } from "../calls/dto/create-call.dto.js";
import { NotesRepository } from "../notes/notes.repository.js";
import { renderNotesMarkdown, safeFilename } from "./markdown.js";

@ApiTags("export")
@Controller("calls")
export class ExportController {
  constructor(private readonly notes: NotesRepository) {}

  @ApiOperation({ summary: "Markdown export with inline receipts" })
  @Get(":id/export.md")
  @Header("content-type", "text/markdown; charset=utf-8")
  async markdown(@Param("id") id: string, @Res() res: Response): Promise<void> {
    const notes = await this.load(id);
    res.setHeader(
      "content-disposition",
      `attachment; filename="${safeFilename(notes.callId, "md")}"`,
    );
    res.send(renderNotesMarkdown(notes));
  }

  @ApiOperation({ summary: "JSON export of the notes payload" })
  @Get(":id/export.json")
  async json(@Param("id") id: string, @Res() res: Response): Promise<void> {
    const notes = await this.load(id);
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader(
      "content-disposition",
      `attachment; filename="${safeFilename(notes.callId, "json")}"`,
    );
    res.send(JSON.stringify(notes, null, 2));
  }

  private async load(id: string): Promise<CallNotes> {
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
    const validated = CallNotesSchema.safeParse(row.payload);
    if (!validated.success) {
      throw new ProblemException("internal_error", "Stored notes are unreadable.");
    }
    return validated.data as CallNotes;
  }
}
