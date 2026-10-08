-- C16 reader site: guide slug, summary, visibility and full-text search document.

-- AlterTable
ALTER TABLE "Flow" ADD COLUMN "slug" TEXT,
ADD COLUMN "summary" TEXT,
ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'published',
ADD COLUMN "search" tsvector;

-- Backfill slug: lowercase title, non-alphanumerics to "-", max 60, "guide" when empty. Oldest flow first;
-- on a clash inside one workspace the next free "-2", "-3", ... is used (checked against every existing slug,
-- so "Setup", "Setup" and "Setup 2" cannot collide).
DO $$
DECLARE r record; b text; cand text; n int;
BEGIN
  FOR r IN SELECT "id", "organizationId", "title" FROM "Flow" WHERE "slug" IS NULL ORDER BY "createdAt", "id" LOOP
    b := COALESCE(NULLIF(trim(both '-' from left(trim(both '-' from regexp_replace(lower(r."title"), '[^a-z0-9]+', '-', 'g')), 60)), ''), 'guide');
    cand := b; n := 1;
    WHILE EXISTS (SELECT 1 FROM "Flow" f WHERE f."organizationId" = r."organizationId" AND f."slug" = cand) LOOP
      n := n + 1;
      cand := b || '-' || n;
    END LOOP;
    UPDATE "Flow" SET "slug" = cand WHERE "id" = r."id";
  END LOOP;
END $$;

-- Backfill search: title (A), summary (B), step text of the latest run (C), 'simple' config.
UPDATE "Flow" f SET "search" =
  setweight(to_tsvector('simple', coalesce(f."title", '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(f."summary", '')), 'B') ||
  setweight(to_tsvector('simple', coalesce((
    SELECT string_agg(coalesce(s."title", '') || ' ' || s."instruction", ' ')
    FROM "Step" s WHERE s."runId" = f."latestRunId"), '')), 'C');

-- CreateIndex
CREATE UNIQUE INDEX "Flow_organizationId_slug_key" ON "Flow"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "Flow_search_idx" ON "Flow" USING GIN ("search");
