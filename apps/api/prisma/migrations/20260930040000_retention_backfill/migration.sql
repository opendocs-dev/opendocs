-- Doc image retention (C10-AC04). Data-only, no schema change.
-- Images of a live flow's latest compiled run become permanent.
UPDATE "Asset" a
SET "expiresAt" = NULL
WHERE a."kind" = 'step'
  AND a."deletedAt" IS NULL
  AND (a."expiresAt" IS NULL OR a."expiresAt" > now())
  AND EXISTS (
    SELECT 1 FROM "Step" s
    JOIN "Flow" f ON f."latestRunId" = s."runId"
    WHERE s."assetId" = a."id" AND f."deletedAt" IS NULL
  );

-- Every other live step image (drafts, superseded runs) gets at most the 7-day draft window.
UPDATE "Asset" a
SET "expiresAt" = LEAST(COALESCE(a."expiresAt", now() + interval '7 days'), now() + interval '7 days')
WHERE a."kind" = 'step'
  AND a."deletedAt" IS NULL
  AND (a."expiresAt" IS NULL OR a."expiresAt" > now())
  AND NOT EXISTS (
    SELECT 1 FROM "Step" s
    JOIN "Flow" f ON f."latestRunId" = s."runId"
    WHERE s."assetId" = a."id" AND f."deletedAt" IS NULL
  );
