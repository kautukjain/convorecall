import { Injectable, Logger } from "@nestjs/common";
import type { CallSource, JobState, Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";

export type ClaimedJob = {
  id: string;
  callId: string;
  source: CallSource;
  sourceRef: string | null;
  storageKey: string | null;
  mimeType: string | null;
  state: JobState;
  attempt: number;
  deadlineAt: Date;
  tokenBudget: number;
};

@Injectable()
export class JobsRepository {
  private readonly logger = new Logger(JobsRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Claims one queued job atomically.
   *
   * `FOR UPDATE SKIP LOCKED` is what lets the queue be a table without becoming a
   * correctness problem: two workers racing for the same row cannot both win, and
   * neither blocks (docs/Jobs.md).
   *
   * The state a job enters depends on its call source — fixture jobs go straight to
   * EXTRACTING because there is nothing to transcribe (ADR-012).
   */
  async claimNext(workerId: string): Promise<ClaimedJob | null> {
    const rows = await this.prisma.$queryRaw<ClaimedJob[]>`
      UPDATE jobs j
      SET
        state = CASE WHEN c.source = 'FIXTURE'
                  THEN 'EXTRACTING'::"JobState"
                  ELSE 'TRANSCRIBING'::"JobState" END,
        "claimedBy"   = ${workerId},
        "startedAt"   = COALESCE(j."startedAt", now()),
        "heartbeatAt" = now(),
        "updatedAt"   = now(),
        attempt       = j.attempt + 1
      FROM calls c
      WHERE c.id = j."callId"
        AND j.id = (
          SELECT id FROM jobs
          WHERE state = 'QUEUED'
          ORDER BY "createdAt"
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
      RETURNING
        j.id, j."callId", j.state, j.attempt, j."deadlineAt", j."tokenBudget",
        c.source, c."sourceRef", c."storageKey", c."mimeType";
    `;
    return rows[0] ?? null;
  }

  async heartbeat(jobId: string): Promise<void> {
    await this.prisma.job.update({
      where: { id: jobId },
      data: { heartbeatAt: new Date() },
    });
  }

  async transition(
    jobId: string,
    state: JobState,
    extra?: { failureReason?: string; failureMessage?: string; lastError?: string },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const terminal: JobState[] = ["SHIPPED", "PARTIAL", "FAILED", "DEADLINE"];
    await client.job.update({
      where: { id: jobId },
      data: {
        state,
        heartbeatAt: new Date(),
        finishedAt: terminal.includes(state) ? new Date() : null,
        failureReason: extra?.failureReason ?? null,
        failureMessage: extra?.failureMessage ?? null,
        lastError: extra?.lastError ?? null,
      },
    });
  }

  /**
   * Returns jobs to the queue, or fails them permanently once they have burned their
   * attempts. Without this a crashed worker leaves a job in TRANSCRIBING forever and
   * the failure invariant is a claim rather than a fact.
   */
  async reclaimStale(staleAfterMs: number, maxAttempts: number): Promise<number> {
    const cutoff = new Date(Date.now() - staleAfterMs);

    const requeued = await this.prisma.job.updateMany({
      where: {
        state: { in: ["TRANSCRIBING", "EXTRACTING"] },
        heartbeatAt: { lt: cutoff },
        attempt: { lt: maxAttempts },
      },
      data: { state: "QUEUED", claimedBy: null, heartbeatAt: null },
    });

    const orphaned = await this.prisma.job.updateMany({
      where: {
        state: { in: ["TRANSCRIBING", "EXTRACTING"] },
        heartbeatAt: { lt: cutoff },
        attempt: { gte: maxAttempts },
      },
      data: {
        state: "FAILED",
        failureReason: "orphaned",
        finishedAt: new Date(),
      },
    });

    const total = requeued.count + orphaned.count;
    if (total > 0) {
      this.logger.warn(
        `Reclaimed ${requeued.count} stale job(s), orphaned ${orphaned.count}`,
      );
    }
    return total;
  }

  /** Budget exhaustion is a distinct outcome from failure (ADR-006). */
  async expireOverdue(): Promise<number> {
    const result = await this.prisma.job.updateMany({
      where: {
        state: { in: ["QUEUED", "TRANSCRIBING", "EXTRACTING"] },
        deadlineAt: { lt: new Date() },
      },
      data: {
        state: "DEADLINE",
        failureReason: "wall_clock_exhausted",
        finishedAt: new Date(),
      },
    });
    if (result.count > 0) {
      this.logger.warn(`${result.count} job(s) hit their deadline`);
    }
    return result.count;
  }
}
