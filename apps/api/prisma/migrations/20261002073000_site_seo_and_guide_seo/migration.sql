-- AlterTable
ALTER TABLE "Flow" ADD COLUMN     "seoTitle" TEXT,
ADD COLUMN     "seoDescription" TEXT,
ADD COLUMN     "noindex" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "WorkspaceSite" ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "faviconAssetId" TEXT,
ADD COLUMN     "ogAssetId" TEXT,
ADD COLUMN     "customMeta" JSONB NOT NULL DEFAULT '[]';

-- AddForeignKey
ALTER TABLE "WorkspaceSite" ADD CONSTRAINT "WorkspaceSite_faviconAssetId_fkey" FOREIGN KEY ("faviconAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSite" ADD CONSTRAINT "WorkspaceSite_ogAssetId_fkey" FOREIGN KEY ("ogAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
