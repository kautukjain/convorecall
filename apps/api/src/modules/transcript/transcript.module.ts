import { Module } from "@nestjs/common";
import { FixtureSttProvider } from "./providers/fixture-stt.provider.js";
import { PyAiSttProvider } from "./providers/pyai-stt.provider.js";
import { TranscriptController } from "./transcript.controller.js";
import { SpeakerNamingService } from "./speaker-naming.service.js";
import { TranscriptRepository } from "./transcript.repository.js";

@Module({
  controllers: [TranscriptController],
  providers: [
    TranscriptRepository,
    FixtureSttProvider,
    PyAiSttProvider,
    SpeakerNamingService,
  ],
  exports: [
    TranscriptRepository,
    FixtureSttProvider,
    PyAiSttProvider,
    SpeakerNamingService,
  ],
})
export class TranscriptModule {}
