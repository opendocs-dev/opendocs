-- AlterTable
ALTER TABLE "Flow" ADD COLUMN     "lastRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Flow_organizationId_lastRunAt_idx" ON "Flow"("organizationId", "lastRunAt");
