import { Module } from "@nestjs/common";
import { NotesModule } from "../notes/notes.module.js";
import { ExportController } from "./export.controller.js";

@Module({
  imports: [NotesModule],
  controllers: [ExportController],
})
export class ExportModule {}
