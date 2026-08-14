import { Injectable } from "@nestjs/common";
import type { Prisma, TranscriptSegment } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";
import type { SttSegment } from "./stt.types.js";

@Injectable()
export class TranscriptRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Replaces any existing transcript for a call. A reclaimed job re-running
   * transcription must not double-insert (docs/Jobs.md idempotency).
   */
  async replaceForCall(
    callId: string,
    segments: SttSegment[],
    durationMs: number,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const client = tx ?? this.prisma;

    await client.transcriptSegment.deleteMany({ where: { callId } });
    await client.transcriptSegment.createMany({
      data: segments.map((segment, index) => ({
        callId,
        index,
        speaker: segment.speaker,
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text,
      })),
    });
    await client.call.update({
      where: { id: callId },
      data: { durationMs },
    });

    return segments.length;
  }

  /** Applies verified speaker names in one transaction. */
  async renameSpeakers(
    callId: string,
    names: Map<string, string>,
  ): Promise<void> {
    if (names.size === 0) return;
    await this.prisma.$transaction(
      [...names.entries()].map(([label, name]) =>
        this.prisma.transcriptSegment.updateMany({
          where: { callId, speaker: label },
          data: { speaker: name },
        }),
      ),
    );
  }

  async findForCall(callId: string): Promise<TranscriptSegment[]> {
    return this.prisma.transcriptSegment.findMany({
      where: { callId },
      orderBy: { index: "asc" },
    });
  }

  async countForCall(callId: string): Promise<number> {
    return this.prisma.transcriptSegment.count({ where: { callId } });
  }
}
