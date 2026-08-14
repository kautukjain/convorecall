import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { MulterModule } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { AudioController } from "./audio.controller.js";
import { CallsController } from "./calls.controller.js";
import { CallsRepository } from "./calls.repository.js";
import { CallsService } from "./calls.service.js";
import { StorageService } from "./storage.service.js";
import { UrlFetchService } from "./url-fetch.service.js";

@Module({
  imports: [
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // Buffered in memory so the bytes can be sniffed before anything is persisted.
        // Fine at demo and self-host scale; a disk or streaming store is the swap if
        // concurrent large uploads ever become real.
        storage: memoryStorage(),
        limits: {
          fileSize: config.get<number>("UPLOAD_MAX_BYTES") ?? 104_857_600,
          files: 1,
        },
      }),
    }),
  ],
  controllers: [CallsController, AudioController],
  providers: [CallsService, CallsRepository, StorageService, UrlFetchService],
  exports: [CallsService, StorageService, UrlFetchService],
})
export class CallsModule {}
