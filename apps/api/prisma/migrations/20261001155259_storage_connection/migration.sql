-- AlterTable
ALTER TABLE "WorkspaceSite" ADD COLUMN     "storageKind" TEXT;

-- CreateTable
CREATE TABLE "StorageConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "secret" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'untested',
    "lastTestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorageConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StorageConnection_organizationId_idx" ON "StorageConnection"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "StorageConnection_organizationId_kind_key" ON "StorageConnection"("organizationId", "kind");

-- AddForeignKey
ALTER TABLE "StorageConnection" ADD CONSTRAINT "StorageConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
