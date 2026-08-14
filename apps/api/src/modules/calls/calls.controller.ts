import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { ProblemException } from "../../common/problem.js";
import {
  toCallResponse,
  toCreatedResponse,
  type CallResponse,
  type CreatedCallResponse,
} from "./calls.presenter.js";
import { CallsService, type UploadedAudio } from "./calls.service.js";
import {
  CallIdParamSchema,
  CreateCallBodySchema,
} from "./dto/create-call.dto.js";

@ApiTags("calls")
@Controller("calls")
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  /**
   * Upload, URL, or fixture (docs/API.md). Returns immediately — analysis is
   * asynchronous and reported through the job record.
   */
  @ApiOperation({
    summary: "Start a call",
    description:
      "Three forms: multipart upload (`file`), JSON `{ url }`, or JSON `{ fixture }`. " +
      "Returns immediately — analysis runs asynchronously and is reported through the " +
      "job record. Content is sniffed by magic bytes; the filename is never trusted.",
  })
  @ApiConsumes("multipart/form-data", "application/json")
  @ApiBody({
    schema: {
      oneOf: [
        {
          type: "object",
          properties: { file: { type: "string", format: "binary" } },
        },
        {
          type: "object",
          properties: { url: { type: "string", format: "uri" } },
        },
        {
          type: "object",
          properties: { fixture: { type: "string", example: "objection-call" } },
        },
      ],
    },
  })
  @ApiResponse({ status: 202, description: "Call accepted; analysis queued." })
  @ApiResponse({ status: 400, description: "invalid_request" })
  @ApiResponse({ status: 413, description: "upload_too_large" })
  @ApiResponse({ status: 415, description: "unsupported_media_type" })
  @ApiResponse({ status: 429, description: "rate_limited" })
  @Post()
  @Throttle({ default: { ttl: 3_600_000, limit: 10 } })
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor("file"))
  async create(
    @UploadedFile() file: UploadedAudio | undefined,
    @Body() body: unknown,
  ): Promise<CreatedCallResponse> {
    if (file) {
      return toCreatedResponse(await this.calls.createFromUpload(file));
    }

    const parsed = CreateCallBodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new ProblemException(
        "invalid_request",
        parsed.error.issues[0]?.message ?? "Malformed request body.",
      );
    }

    return toCreatedResponse(await this.calls.createFromBody(parsed.data));
  }

  @ApiOperation({ summary: "Job state and budget for one call" })
  @ApiResponse({ status: 200, description: "Current state; exitStatus is set only when terminal." })
  @ApiResponse({ status: 404, description: "call_not_found" })
  @Get(":id")
  async findOne(@Param("id") id: string): Promise<CallResponse> {
    const parsed = CallIdParamSchema.safeParse(id);
    if (!parsed.success) {
      // A malformed id is not a lookup miss, but it is also not worth distinguishing
      // to a client — both mean "no such call".
      throw new ProblemException("call_not_found", "No call with that id.");
    }
    return toCallResponse(await this.calls.findById(parsed.data));
  }
}
