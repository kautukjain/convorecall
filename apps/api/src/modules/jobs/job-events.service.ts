import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";

export type JobEventType =
  | "state"
  | "section"
  | "progress"
  | "terminal"
  | "error";

export type EmittedEvent = {
  id: string;
  type: JobEventType;
  data: Record<string, unknown>;
};

/**
 * Append-only event log backing SSE (docs/Jobs.md).
 *
 * Events are persisted rather than pushed straight to a socket, so a client that
 * reconnects with `Last-Event-ID` can be told exactly what it missed. Nothing lives
 * only in the stream.
 */
@Injectable()
export class JobEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async append(
    jobId: string,
    type: JobEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.jobEvent.create({
      data: { jobId, type, payload: payload as Prisma.InputJsonObject },
    });
  }

  async since(jobId: string, lastEventId: bigint): Promise<EmittedEvent[]> {
    const rows = await this.prisma.jobEvent.findMany({
      where: { jobId, id: { gt: lastEventId } },
      orderBy: { id: "asc" },
      take: 200,
    });

    return rows.map((row) => ({
      id: row.id.toString(),
      type: row.type as JobEventType,
      data: (row.payload ?? {}) as Record<string, unknown>,
    }));
  }

  async findJobIdForCall(callId: string): Promise<string | null> {
    const job = await this.prisma.job.findUnique({
      where: { callId },
      select: { id: true },
    });
    return job?.id ?? null;
  }
}
