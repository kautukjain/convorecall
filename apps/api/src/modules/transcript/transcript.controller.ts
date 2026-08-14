import { Controller, Get, Param } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ProblemException } from "../../common/problem.js";
import { CallIdParamSchema } from "../calls/dto/create-call.dto.js";
import { TranscriptRepository } from "./transcript.repository.js";

export type TranscriptResponse = {
  callId: string;
  speakers: string[];
  segments: Array<{
    id: string;
    index: number;
    speaker: string;
    startMs: number;
    endMs: number;
    text: string;
  }>;
};

@ApiTags("transcript")
@Controller("calls")
export class TranscriptController {
  constructor(private readonly transcripts: TranscriptRepository) {}

  @ApiOperation({ summary: "Timed, speaker-labelled transcript" })
  @ApiResponse({ status: 200, description: "Transcript segments in order." })
  @ApiResponse({ status: 409, description: "transcript_not_ready" })
  @Get(":id/transcript")
  async findOne(@Param("id") id: string): Promise<TranscriptResponse> {
    const parsed = CallIdParamSchema.safeParse(id);
    if (!parsed.success) {
      throw new ProblemException("call_not_found", "No call with that id.");
    }

    const segments = await this.transcripts.findForCall(parsed.data);
    if (segments.length === 0) {
      // 409, not 404: the call may well exist and simply not be transcribed yet
      // (docs/API.md).
      throw new ProblemException(
        "transcript_not_ready",
        "Transcription has not completed for this call.",
      );
    }

    return {
      callId: parsed.data,
      speakers: [...new Set(segments.map((segment) => segment.speaker))],
      segments: segments.map((segment) => ({
        id: segment.id,
        index: segment.index,
        speaker: segment.speaker,
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text,
      })),
    };
  }
}
