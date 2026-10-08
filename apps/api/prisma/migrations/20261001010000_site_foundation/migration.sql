-- C15 site foundation: tenant address data, reserved names, slug backfill, then the slug CHECK.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "suspendedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WorkspaceSite" (
    "organizationId" TEXT NOT NULL,
    "siteTitle" TEXT NOT NULL,
    "tagline" TEXT NOT NULL DEFAULT '',
    "preset" TEXT NOT NULL DEFAULT 'sage',
    "indexing" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addressChangeDay" TIMESTAMP(3),
    "addressChangeCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WorkspaceSite_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "SiteAddressHistory" (
    "slug" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "retiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteAddressHistory_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "ReservedName" (
    "name" TEXT NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "ReservedName_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "SiteAddressHistory_organizationId_idx" ON "SiteAddressHistory"("organizationId");

-- AddForeignKey
ALTER TABLE "WorkspaceSite" ADD CONSTRAINT "WorkspaceSite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteAddressHistory" ADD CONSTRAINT "SiteAddressHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: names no workspace may claim.
INSERT INTO "ReservedName" ("name", "reason") VALUES
  ('www', 'system'), ('api', 'system'), ('admin', 'system'), ('app', 'system'),
  ('i', 'system'), ('mail', 'system'), ('docs', 'system'), ('status', 'system'),
  ('support', 'trust'), ('opendocs', 'brand'), ('login', 'phishing'), ('paypal', 'phishing');

-- Backfill 1: an address that breaks the rule or is reserved keeps working as a redirect, then gets a valid one.
INSERT INTO "SiteAddressHistory" ("slug", "organizationId")
SELECT lower(o."slug"), o."id" FROM "Organization" o
WHERE NOT (o."slug" ~ '^[a-z0-9]([a-z0-9]|-(?!-))*[a-z0-9]$' AND char_length(o."slug") BETWEEN 3 AND 30)
   OR o."slug" IN (SELECT "name" FROM "ReservedName")
ON CONFLICT ("slug") DO NOTHING;

UPDATE "Organization" o SET "slug" = 'ws-' || substr(md5(o."id"), 1, 8)
WHERE NOT (o."slug" ~ '^[a-z0-9]([a-z0-9]|-(?!-))*[a-z0-9]$' AND char_length(o."slug") BETWEEN 3 AND 30)
   OR o."slug" IN (SELECT "name" FROM "ReservedName");

-- Backfill 2: one site row per existing workspace.
INSERT INTO "WorkspaceSite" ("organizationId", "siteTitle")
SELECT o."id", o."name" FROM "Organization" o
ON CONFLICT ("organizationId") DO NOTHING;

-- The rule, enforced in the database once every row satisfies it.
ALTER TABLE "Organization" ADD CONSTRAINT organization_slug_format
  CHECK ("slug" ~ '^[a-z0-9]([a-z0-9]|-(?!-))*[a-z0-9]$' AND char_length("slug") BETWEEN 3 AND 30);
