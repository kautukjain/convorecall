import { Module } from "@nestjs/common";
import { AiOrchestratorService } from "./ai-orchestrator.service.js";
import { LlmClient } from "./llm.client.js";
import { RecapClient } from "./recap.client.js";
import { ReplayExtractorService } from "./replay-extractor.service.js";

@Module({
  providers: [LlmClient, AiOrchestratorService, ReplayExtractorService, RecapClient],
  exports: [AiOrchestratorService, ReplayExtractorService, RecapClient],
})
export class AiModule {}
