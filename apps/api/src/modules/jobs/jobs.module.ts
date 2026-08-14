import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module.js";
import { CallsModule } from "../calls/calls.module.js";
import { NotesModule } from "../notes/notes.module.js";
import { TranscriptModule } from "../transcript/transcript.module.js";
import { EventsController } from "./events.controller.js";
import { JobEventsService } from "./job-events.service.js";
import { JobsRepository } from "./jobs.repository.js";
import { WorkerService } from "./worker.service.js";

@Module({
  imports: [TranscriptModule, CallsModule, NotesModule, AiModule],
  controllers: [EventsController],
  providers: [JobsRepository, JobEventsService, WorkerService],
  exports: [JobsRepository, JobEventsService],
})
export class JobsModule {}
