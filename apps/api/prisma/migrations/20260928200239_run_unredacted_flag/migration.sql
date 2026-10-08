-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "hasUnredactedStep" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: a run already has an unredacted step if any of its steps was stored
-- with redaction mode "off" or with no redaction mode at all.
UPDATE "Run"
SET "hasUnredactedStep" = true
WHERE "id" IN (
  SELECT DISTINCT "runId"
  FROM "Step"
  WHERE "redactionMode" = 'off' OR "redactionMode" IS NULL
);
