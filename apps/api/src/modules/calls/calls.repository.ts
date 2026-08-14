import { Injectable } from "@nestjs/common";
import type { Call, CallSource, Job, Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";

export type CallWithJob = Call & { job: Job | null };

export type CreateCallInput = {
  source: CallSource;
  sourceRef?: string | null;
  storageKey?: string | null;
  originalName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  deadlineAt: Date;
  tokenBudget: number;
};

/** Only this layer knows Prisma (.cursor/rules/backend.mdc). */
@Injectable()
export class CallsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Call and Job are created together. The job row is the durable record, and the
   * failure invariant depends on it existing before the response is sent — so there
   * must be no window in which a call exists without one (docs/Jobs.md).
   */
  async createWithJob(input: CreateCallInput): Promise<CallWithJob> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const call = await tx.call.create({
        data: {
          source: input.source,
          sourceRef: input.sourceRef ?? null,
          storageKey: input.storageKey ?? null,
          originalName: input.originalName ?? null,
          mimeType: input.mimeType ?? null,
          sizeBytes: input.sizeBytes ?? null,
        },
      });

      const job = await tx.job.create({
        data: {
          callId: call.id,
          deadlineAt: input.deadlineAt,
          tokenBudget: input.tokenBudget,
        },
      });

      return { ...call, job };
    });
  }

  async findById(id: string): Promise<CallWithJob | null> {
    return this.prisma.call.findUnique({
      where: { id },
      include: { job: true },
    });
  }
}
