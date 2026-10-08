import { Elysia } from 'elysia';
import { auth } from '../auth';
import { getPrisma } from '../db';
import { ApiError } from '../errors';
import { startOfUtcDay } from '../quota';
import { roleFor } from '../site/role';
import { getInstanceOrg } from '../instance-org';

const requireSessionAndMember = async (request: Request) => {
  const session = await auth.api.getSession({ headers: request.headers });
  const organizationId = session ? (await getInstanceOrg()).id : undefined;
  if (!session || !organizationId) {
    throw new ApiError(401, 'unauthorized', 'A valid session is required');
  }
  const role = await roleFor(session.user.id, organizationId);
  if (!role) {
    throw new ApiError(403, 'unauthorized', 'You are not a member of this workspace');
  }
  return { userId: session.user.id, organizationId, role };
};

export const analyticsRoute = new Elysia().get(
  '/api/v1/analytics',
  async ({ request, query }) => {
    const { organizationId } = await requireSessionAndMember(request);
    const prisma = getPrisma();

    // Parse range: 7, 30, or 90 days. Default is 30 (C14-AC29).
    const rawDays = Number(query.days);
    const days = rawDays === 7 || rawDays === 90 ? rawDays : 30;

    const today = startOfUtcDay(new Date());
    const startDate = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

    // 1. Guide views and helpful votes from AnalyticsDaily joined with Flow for this organization
    const flowAnalytics = await prisma.analyticsDaily.findMany({
      where: {
        flow: { organizationId, deletedAt: null },
        day: { gte: startDate, lte: today },
      },
      include: {
        flow: { select: { id: true, publicId: true, title: true, slug: true } },
      },
    });

    let totalViews = 0;
    let totalHelpfulYes = 0;
    let totalHelpfulNo = 0;

    // Daily views map: pre-populate every day from startDate to today with 0
    const viewsByDay = new Map<string, number>();
    for (let d = new Date(startDate); d <= today; d.setUTCDate(d.getUTCDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      viewsByDay.set(key, 0);
    }

    // Guide views map
    const viewsByFlow = new Map<
      string,
      { id: string; public_id: string; title: string; slug: string | null; views: number }
    >();

    for (const record of flowAnalytics) {
      totalViews += record.views;
      totalHelpfulYes += record.helpfulYes;
      totalHelpfulNo += record.helpfulNo;

      const dayKey = record.day.toISOString().slice(0, 10);
      viewsByDay.set(dayKey, (viewsByDay.get(dayKey) ?? 0) + record.views);

      const existingFlow = viewsByFlow.get(record.flowId);
      if (existingFlow) {
        existingFlow.views += record.views;
      } else {
        viewsByFlow.set(record.flowId, {
          id: record.flow.id,
          public_id: record.flow.publicId,
          title: record.flow.title,
          slug: record.flow.slug,
          views: record.views,
        });
      }
    }

    const viewsPerDay = Array.from(viewsByDay.entries()).map(([day, views]) => ({
      day,
      views,
    }));

    const topGuides = Array.from(viewsByFlow.values())
      .filter((g) => g.views > 0)
      .sort((a, b) => b.views - a.views)
      .slice(0, 5);

    // 2. Searches from SearchLog
    const searchLogs = await prisma.searchLog.findMany({
      where: {
        organizationId,
        day: { gte: startDate, lte: today },
      },
    });

    let totalSearches = 0;
    let searchesWithResults = 0;

    const queriesMap = new Map<string, { query: string; times: number; results: number }>();
    for (const log of searchLogs) {
      totalSearches += log.times;
      if (log.results > 0) {
        searchesWithResults += log.times;
      }

      const existing = queriesMap.get(log.query);
      if (existing) {
        existing.times += log.times;
        existing.results = Math.max(existing.results, log.results);
      } else {
        queriesMap.set(log.query, {
          query: log.query,
          times: log.times,
          results: log.results,
        });
      }
    }

    const allQueries = Array.from(queriesMap.values());
    const topSearches = allQueries
      .sort((a, b) => b.times - a.times)
      .slice(0, 5);

    const searchesWithoutResults = allQueries
      .filter((q) => q.results === 0)
      .sort((a, b) => b.times - a.times)
      .slice(0, 5)
      .map(({ query, times }) => ({ query, times }));

    const searchesWithResultsPercent =
      totalSearches > 0 ? Math.round((searchesWithResults / totalSearches) * 100) : 0;

    const totalVotes = totalHelpfulYes + totalHelpfulNo;
    const markedHelpfulPercent =
      totalVotes > 0 ? Math.round((totalHelpfulYes / totalVotes) * 100) : 0;

    return {
      days,
      views: totalViews,
      searches: totalSearches,
      searches_with_results_percent: searchesWithResultsPercent,
      marked_helpful_percent: markedHelpfulPercent,
      views_per_day: viewsPerDay,
      top_guides: topGuides,
      top_searches: topSearches,
      searches_without_results: searchesWithoutResults,
    };
  },
);
