-- CreateTable
CREATE TABLE "AiGap" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'open',
    "flowId" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiGap_organizationId_status_count_idx" ON "AiGap"("organizationId", "status", "count");

-- CreateIndex
CREATE UNIQUE INDEX "AiGap_organizationId_query_key" ON "AiGap"("organizationId", "query");

-- AddForeignKey
ALTER TABLE "AiGap" ADD CONSTRAINT "AiGap_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
