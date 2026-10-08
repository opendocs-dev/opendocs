import type { Prisma } from '../../generated/prisma/client';

/**
 * Refreshes the search document for a flow based on its title, summary, and latest run's steps.
 * Uses tsvector with weighted tokens for full-text search.
 */
export const refreshSearchDocument = async (
  tx: Prisma.TransactionClient,
  flowId: string,
  runId: string,
) => {
  await tx.$executeRaw`
    UPDATE "Flow" SET "search" =
      setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(summary, '')), 'B') ||
      setweight(to_tsvector('simple', coalesce((
        SELECT string_agg(coalesce(s."title", '') || ' ' || s."instruction", ' ')
        FROM "Step" s WHERE s."runId" = ${runId} AND s."hidden" = false
      ), '')), 'C')
    WHERE id = ${flowId}
  `;
};
