-- CreateEnum
CREATE TYPE "CallSource" AS ENUM ('UPLOAD', 'URL', 'FIXTURE');

-- CreateEnum
CREATE TYPE "JobState" AS ENUM ('QUEUED', 'TRANSCRIBING', 'EXTRACTING', 'SHIPPED', 'PARTIAL', 'FAILED', 'DEADLINE');

-- CreateEnum
CREATE TYPE "NotesExitStatus" AS ENUM ('SHIPPED', 'PARTIAL', 'FAILED', 'DEADLINE');

-- CreateTable
CREATE TABLE "calls" (
    "id" UUID NOT NULL,
    "source" "CallSource" NOT NULL,
    "sourceRef" TEXT,
    "storageKey" TEXT,
    "originalName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "callId" UUID NOT NULL,
    "state" "JobState" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "claimedBy" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "tokenBudget" INTEGER NOT NULL,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_events" (
    "id" BIGSERIAL NOT NULL,
    "jobId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcript_segments" (
    "id" UUID NOT NULL,
    "callId" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "speaker" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "transcript_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" UUID NOT NULL,
    "callId" UUID NOT NULL,
    "exitStatus" "NotesExitStatus" NOT NULL,
    "payload" JSONB NOT NULL,
    "droppedClaims" INTEGER NOT NULL DEFAULT 0,
    "droppedSections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "promptVersion" TEXT NOT NULL,
    "sttModel" TEXT,
    "llmModel" TEXT NOT NULL,
    "tokensUsed" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shares" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "callId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calls_createdAt_idx" ON "calls"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_callId_key" ON "jobs"("callId");

-- CreateIndex
CREATE INDEX "jobs_state_createdAt_idx" ON "jobs"("state", "createdAt");

-- CreateIndex
CREATE INDEX "jobs_state_heartbeatAt_idx" ON "jobs"("state", "heartbeatAt");

-- CreateIndex
CREATE INDEX "jobs_state_deadlineAt_idx" ON "jobs"("state", "deadlineAt");

-- CreateIndex
CREATE INDEX "job_events_jobId_id_idx" ON "job_events"("jobId", "id");

-- CreateIndex
CREATE INDEX "transcript_segments_callId_startMs_idx" ON "transcript_segments"("callId", "startMs");

-- CreateIndex
CREATE UNIQUE INDEX "transcript_segments_callId_index_key" ON "transcript_segments"("callId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "notes_callId_key" ON "notes"("callId");

-- CreateIndex
CREATE UNIQUE INDEX "shares_token_key" ON "shares"("token");

-- CreateIndex
CREATE INDEX "shares_callId_idx" ON "shares"("callId");

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_callId_fkey" FOREIGN KEY ("callId") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_callId_fkey" FOREIGN KEY ("callId") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_callId_fkey" FOREIGN KEY ("callId") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shares" ADD CONSTRAINT "shares_callId_fkey" FOREIGN KEY ("callId") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
