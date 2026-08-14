import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";

export type HealthResponse = {
  ok: true;
  service: string;
  version: string;
};

/**
 * Liveness only. Deliberately touches neither the database nor any provider, so it stays
 * honest under partial outage and `pnpm dev` works before Postgres exists (docs/API.md).
 */
@ApiTags("health")
@Controller("health")
@SkipThrottle()
export class HealthController {
  @ApiOperation({ summary: "Liveness — touches no database or provider" })
  @Get()
  check(): HealthResponse {
    return {
      ok: true,
      service: "opengong-api",
      version: process.env.npm_package_version ?? "0.1.0",
    };
  }
}
