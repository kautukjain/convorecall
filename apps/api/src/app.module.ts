import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { validateEnv } from "./config/env.js";
import { PrismaModule } from "./database/prisma.module.js";
import { CallsModule } from "./modules/calls/calls.module.js";
import { ExportModule } from "./modules/export/export.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { JobsModule } from "./modules/jobs/jobs.module.js";
import { NotesModule } from "./modules/notes/notes.module.js";
import { ShareModule } from "./modules/share/share.module.js";
import { TranscriptModule } from "./modules/transcript/transcript.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ["../../.env"],
      validate: validateEnv,
    }),
    // Limits from docs/API.md. A public share link is the highest-risk surface in the
    // product; leaving it unlimited because auth is deferred would be the wrong trade.
    //
    // Exactly ONE named throttler is declared here on purpose. Every named throttler in
    // this array applies to every route, so declaring the stricter per-endpoint limits
    // globally capped the whole API at the tightest one — 10 requests/hour. Tighter
    // limits belong on their routes via `@Throttle({ default: … })`.
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 300 }]),
    PrismaModule,
    HealthModule,
    CallsModule,
    TranscriptModule,
    NotesModule,
    ExportModule,
    ShareModule,
    JobsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
