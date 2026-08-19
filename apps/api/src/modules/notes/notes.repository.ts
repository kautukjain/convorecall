import { Injectable } from "@nestjs/common";
import type { Notes, NotesExitStatus, Prisma } from "@prisma/client";
import type { CallNotes } from "@convorecall/types";
import { PrismaService } from "../../database/prisma.service.js";

@Injectable()
export class NotesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Written once, in the same transaction as the terminal job state (docs/Jobs.md). */
  async upsert(
    callId: string,
    notes: CallNotes,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const data = {
      exitStatus: notes.exitStatus.toUpperCase() as NotesExitStatus,
      payload: notes as unknown as Prisma.InputJsonObject,
      droppedClaims: notes.metadata.droppedClaims,
      droppedSections: notes.metadata.droppedSections,
      promptVersion: notes.metadata.promptVersion,
      sttModel: notes.metadata.sttModel,
      llmModel: notes.metadata.llmModel,
      tokensUsed: notes.metadata.tokensUsed,
      durationMs: notes.metadata.durationMs,
    };

    await client.notes.upsert({
      where: { callId },
      create: { callId, ...data },
      update: data,
    });
  }

  async findForCall(callId: string): Promise<Notes | null> {
    return this.prisma.notes.findUnique({ where: { callId } });
  }
}
