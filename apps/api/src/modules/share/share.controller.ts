import { Controller, Get, Header, HttpCode, Param, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ProblemException } from "../../common/problem.js";
import { CallIdParamSchema } from "../calls/dto/create-call.dto.js";
import { ShareService, type PublicNotes } from "./share.service.js";

@ApiTags("share")
@Controller()
export class ShareController {
  constructor(private readonly share: ShareService) {}

  @ApiOperation({ summary: "Create a public read-only link" })
  @ApiResponse({ status: 201, description: "32 CSPRNG bytes, base64url." })
  @Post("calls/:id/share")
  @Throttle({ default: { ttl: 3_600_000, limit: 30 } })
  @HttpCode(201)
  async create(@Param("id") id: string) {
    const parsed = CallIdParamSchema.safeParse(id);
    if (!parsed.success) {
      throw new ProblemException("call_not_found", "No call with that id.");
    }
    return this.share.create(parsed.data);
  }

  /** Public, unauthenticated, read-only. Never indexed. */
  @ApiOperation({
    summary: "Read shared notes",
    description: "Public and unauthenticated. Served noindex; operator fields removed.",
  })
  @ApiResponse({ status: 410, description: "share_expired" })
  @Get("share/:token")
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Header("x-robots-tag", "noindex, nofollow")
  @Header("cache-control", "no-store")
  async read(@Param("token") token: string): Promise<PublicNotes> {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
      throw new ProblemException("share_not_found", "This link is not valid.");
    }
    return this.share.resolve(token);
  }
}
