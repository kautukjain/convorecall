import { randomBytes } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { CallNotesSchema } from "@opengong/validators";
import type { CallNotes } from "@opengong/types";
import { ProblemException } from "../../common/problem.js";
import { PrismaService } from "../../database/prisma.service.js";

/** Public notes: the reader's view, without operator telemetry. */
export type PublicNotes = Omit<CallNotes, "callId" | "metadata"> & {
  metadata: {
    exitStatus: string;
    droppedClaims: number;
    droppedSections: string[];
    generatedAt: string;
  };
};

@Injectable()
export class ShareService {
  private readonly logger = new Logger(ShareService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(callId: string): Promise<{
    token: string;
    url: string;
    expiresAt: string | null;
    createdAt: string;
  }> {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      select: { id: true },
    });
    if (!call) {
      throw new ProblemException("call_not_found", "No call with that id.");
    }

    // 32 CSPRNG bytes. Never sequential, never derived from the call id — the token is
    // the only thing standing between a public URL and a customer's call.
    const token = randomBytes(32).toString("base64url");

    const share = await this.prisma.share.create({
      data: { token, callId },
    });

    const webUrl = (process.env.WEB_URL ?? "http://localhost:3000").replace(
      /\/+$/,
      "",
    );

    this.logger.log(`Created share for call ${callId}`);

    return {
      token: share.token,
      url: `${webUrl}/share/${share.token}`,
      expiresAt: share.expiresAt?.toISOString() ?? null,
      createdAt: share.createdAt.toISOString(),
    };
  }

  async resolve(token: string): Promise<PublicNotes> {
    const share = await this.prisma.share.findUnique({
      where: { token },
      include: { call: { include: { notes: true } } },
    });

    if (!share) {
      throw new ProblemException("share_not_found", "This link is not valid.");
    }
    if (share.revokedAt) {
      throw new ProblemException("share_expired", "This link has been revoked.");
    }
    if (share.expiresAt && share.expiresAt.getTime() < Date.now()) {
      throw new ProblemException("share_expired", "This link has expired.");
    }

    const notes = share.call.notes;
    if (!notes) {
      throw new ProblemException(
        "notes_not_ready",
        "Analysis has not completed for this call.",
      );
    }

    const parsed = CallNotesSchema.safeParse(notes.payload);
    if (!parsed.success) {
      throw new ProblemException(
        "internal_error",
        "Stored notes are unreadable.",
        parsed.error.issues.map((i) => i.message).join("; "),
      );
    }

    const full = parsed.data as CallNotes;

    // Token counts, model ids, and prompt versions are operator detail. A public reader
    // gets the notes and the honesty signals, nothing about how the sausage was made.
    return {
      exitStatus: full.exitStatus,
      summary: full.summary,
      intent: full.intent,
      objections: full.objections,
      nextSteps: full.nextSteps,
      followUpEmail: full.followUpEmail,
      metadata: {
        exitStatus: full.metadata.exitStatus,
        droppedClaims: full.metadata.droppedClaims,
        droppedSections: full.metadata.droppedSections,
        generatedAt: full.metadata.generatedAt,
      },
    };
  }
}
