import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module.js";
import { EvidenceModule } from "../evidence/evidence.module.js";
import { NotesController } from "./notes.controller.js";
import { NotesRepository } from "./notes.repository.js";
import { NotesService } from "./notes.service.js";

@Module({
  imports: [AiModule, EvidenceModule],
  controllers: [NotesController],
  providers: [NotesService, NotesRepository],
  exports: [NotesService, NotesRepository],
})
export class NotesModule {}
