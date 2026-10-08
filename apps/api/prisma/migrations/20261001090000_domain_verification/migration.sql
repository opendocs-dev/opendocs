-- C14-AC12 custom domain: additive columns only, no backfill needed (all null by default).

-- AlterTable
ALTER TABLE "WorkspaceSite" ADD COLUMN "customDomain" TEXT,
ADD COLUMN "domainStatus" TEXT,
ADD COLUMN "certExpiresAt" TIMESTAMP(3),
ADD COLUMN "lastCheckedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceSite_customDomain_key" ON "WorkspaceSite"("customDomain");
