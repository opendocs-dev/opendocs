import { getPrisma } from '../db';
import { startOfUtcDay } from '../quota';

/**
 * Records a single guide view on today's UTC day in AnalyticsDaily.
 * Counts only, no visitor cookies or IP tracking (C14-AC29).
 */
export async function recordView(flowId: string, now: Date = new Date()): Promise<void> {
  const day = startOfUtcDay(now);
  const prisma = getPrisma();
  await prisma.analyticsDaily.upsert({
    where: { flowId_day: { flowId, day } },
    update: { views: { increment: 1 } },
    create: { flowId, day, views: 1 },
  });
}

/**
 * Records a helpful vote (yes / no) on today's UTC day in AnalyticsDaily.
 * Counts only, no visitor cookies or IP tracking (C14-AC04).
 */
export async function recordHelpfulVote(
  flowId: string,
  helpful: boolean,
  now: Date = new Date(),
): Promise<void> {
  const day = startOfUtcDay(now);
  const prisma = getPrisma();
  await prisma.analyticsDaily.upsert({
    where: { flowId_day: { flowId, day } },
    update: helpful ? { helpfulYes: { increment: 1 } } : { helpfulNo: { increment: 1 } },
    create: {
      flowId,
      day,
      helpfulYes: helpful ? 1 : 0,
      helpfulNo: helpful ? 0 : 1,
    },
  });
}

/**
 * Records a search query in SearchLog and optionally increments the search count
 * for each matched flow in AnalyticsDaily (C14-AC29).
 */
export async function recordSearch(
  organizationId: string,
  query: string,
  resultsCount: number,
  matchedFlowIds: string[] = [],
  now: Date = new Date(),
): Promise<void> {
  const normalized = query.trim().toLowerCase().slice(0, 100);
  if (!normalized) return;
  const day = startOfUtcDay(now);
  const prisma = getPrisma();

  await prisma.searchLog.upsert({
    where: { organizationId_day_query: { organizationId, day, query: normalized } },
    update: { times: { increment: 1 }, results: resultsCount },
    create: { organizationId, day, query: normalized, results: resultsCount, times: 1 },
  });

  if (matchedFlowIds.length > 0) {
    for (const flowId of matchedFlowIds) {
      await prisma.analyticsDaily.upsert({
        where: { flowId_day: { flowId, day } },
        update: { searches: { increment: 1 } },
        create: { flowId, day, searches: 1 },
      });
    }
  }
}
