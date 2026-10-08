-- C23 self-hosted MVP: one workspace per instance, env-configured, S3 only.
--
-- Drops every multi-tenant, billing, plan, credit, platform-staff and AI-catalog table in
-- one step. A database that holds more than one Organization is NOT supported: start from
-- a fresh database (single-workspace data is kept as is).
--
-- FK / cascade review:
--   * Every dropped table only references Organization / User / Flow / Asset (parents that
--     stay), so no remaining table loses a referenced row or needs its FK changed.
--   * Nothing that stays references a dropped table, except Asset.provider* (plain columns,
--     dropped below) and WorkspaceSite, which is renamed rather than dropped (see below).
--   * AuditLog.organizationId stays ON DELETE SET NULL; Report's SET NULL FKs go with it.

-- DropForeignKey
ALTER TABLE "AiAssistant" DROP CONSTRAINT "AiAssistant_organizationId_fkey";
ALTER TABLE "AiCreditLedger" DROP CONSTRAINT "AiCreditLedger_organizationId_fkey";
ALTER TABLE "AiGap" DROP CONSTRAINT "AiGap_organizationId_fkey";
ALTER TABLE "Invitation" DROP CONSTRAINT "Invitation_inviterId_fkey";
ALTER TABLE "Invitation" DROP CONSTRAINT "Invitation_organizationId_fkey";
ALTER TABLE "Report" DROP CONSTRAINT "Report_flowId_fkey";
ALTER TABLE "Report" DROP CONSTRAINT "Report_organizationId_fkey";
ALTER TABLE "SiteAddressHistory" DROP CONSTRAINT "SiteAddressHistory_organizationId_fkey";
ALTER TABLE "StorageConnection" DROP CONSTRAINT "StorageConnection_organizationId_fkey";
ALTER TABLE "WorkspaceBilling" DROP CONSTRAINT "WorkspaceBilling_organizationId_fkey";

-- DropTable
DROP TABLE "AiAssistant";
DROP TABLE "AiCreditLedger";
DROP TABLE "AiGap";
DROP TABLE "AiModel";
DROP TABLE "AiPlatformSettings";
DROP TABLE "AiProvider";
DROP TABLE "BillingEvent";
DROP TABLE "Invitation";
DROP TABLE "PlanConfig";
DROP TABLE "Report";
DROP TABLE "ReservedName";
DROP TABLE "SiteAddressHistory";
DROP TABLE "StorageConnection";
DROP TABLE "UsageDaily";
DROP TABLE "WorkspaceBilling";

-- WorkspaceSite becomes SiteSettings: the one site's appearance and SEO row. Renamed (not
-- dropped) so the existing single workspace keeps its settings; the tenant-only columns go.
ALTER TABLE "WorkspaceSite" RENAME TO "SiteSettings";
ALTER TABLE "SiteSettings" RENAME CONSTRAINT "WorkspaceSite_pkey" TO "SiteSettings_pkey";
ALTER TABLE "SiteSettings" RENAME CONSTRAINT "WorkspaceSite_organizationId_fkey" TO "SiteSettings_organizationId_fkey";
ALTER TABLE "SiteSettings" RENAME CONSTRAINT "WorkspaceSite_faviconAssetId_fkey" TO "SiteSettings_faviconAssetId_fkey";
ALTER TABLE "SiteSettings" RENAME CONSTRAINT "WorkspaceSite_ogAssetId_fkey" TO "SiteSettings_ogAssetId_fkey";
-- The unique index on customDomain is dropped together with the column.
ALTER TABLE "SiteSettings"
  DROP COLUMN "addressChangeDay",
  DROP COLUMN "addressChangeCount",
  DROP COLUMN "customDomain",
  DROP COLUMN "domainStatus",
  DROP COLUMN "certExpiresAt",
  DROP COLUMN "lastCheckedAt",
  DROP COLUMN "storageKind",
  DROP COLUMN "customMeta";

-- AlterTable: storage is S3 only, so the provider routing columns go (providerFileId stays
-- as the object key).
ALTER TABLE "Asset" DROP COLUMN "provider", DROP COLUMN "providerAccount";

-- AlterTable: tenant suspension and platform staff are gone.
ALTER TABLE "Organization" DROP COLUMN "suspendedAt";
ALTER TABLE "User"
  DROP COLUMN "notifyAiCredits",
  DROP COLUMN "notifyContentGaps",
  DROP COLUMN "notifyInviteAccepted",
  DROP COLUMN "staffRole",
  DROP COLUMN "twoFactorEnabled";
