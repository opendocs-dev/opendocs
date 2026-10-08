import { ListFlowsResponseSchema } from '@opendocs/core';
import { Elysia } from 'elysia';
import { resolveOrganizationId } from '../auth-context';
import { getPrisma } from '../db';
import { docUrl } from '../doc-url';
import { ApiError } from '../errors';
import { Prisma } from '../../generated/prisma/client';

const invalid = (message: string) => new ApiError(422, 'validation_failed', message);

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const parseLimit = (raw: string | undefined): number => {
  if (raw === undefined) return DEFAULT_LIMIT;
  if (!/^\d+$/.test(raw)) throw invalid('limit must be a positive integer');
  const value = Number(raw);
  if (value < 1 || value > MAX_LIMIT) throw invalid(`limit must be between 1 and ${MAX_LIMIT}`);
  return value;
};

const parseQuery = (raw: string | undefined): string => {
  if (raw === undefined) return '';
  return raw.trim().slice(0, 100);
};

const parseVisibility = (raw: string | undefined): string | undefined => {
  if (raw === undefined) return undefined;
  if (raw === 'published' || raw === 'unlisted' || raw === 'draft') return raw;
  throw invalid('visibility must be "published", "unlisted", or "draft"');
};

export const flowsRoute = new Elysia().get(
  '/api/v1/flows',
  async ({ request, query, status }) => {
    const organizationId = await resolveOrganizationId(request);
    const limit = parseLimit(query.limit as string | undefined);
    const cursor = query.cursor as string | undefined;
    const q = parseQuery(query.q as string | undefined);
    const categoryParam = query.category as string | undefined;
    const visibility = parseVisibility(query.visibility as string | undefined);
    const prisma = getPrisma();

    // Validate and resolve category parameter
    let categoryId: string | null | undefined;
    if (categoryParam !== undefined) {
      if (categoryParam === 'none') {
        categoryId = null;
      } else {
        // Treat it as a category id
        const category = await prisma.category.findFirst({
          where: { organizationId, id: categoryParam },
          select: { id: true },
        });
        if (!category) throw invalid('category does not match a known category');
        categoryId = category.id;
      }
    }

    let cursorFlow: { lastRunAt: Date; publicId: string } | null = null;
    if (cursor !== undefined) {
      cursorFlow = await prisma.flow.findFirst({
        where: { publicId: cursor, organizationId },
        select: { lastRunAt: true, publicId: true },
      });
      if (!cursorFlow) throw invalid('cursor does not match a known flow');
    }

    const publicIdParam = query.public_id as string | undefined;

    const where: Prisma.FlowWhereInput = {
      organizationId,
      deletedAt: null,
      // Strictly after the cursor row in (lastRunAt desc, publicId desc) order.
      ...(cursorFlow
        ? {
            OR: [
              { lastRunAt: { lt: cursorFlow.lastRunAt } },
              { lastRunAt: cursorFlow.lastRunAt, publicId: { lt: cursorFlow.publicId } },
            ],
          }
        : {}),
      ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
      ...(categoryId !== undefined ? { categoryId } : {}),
      ...(visibility ? { visibility } : {}),
      ...(publicIdParam ? { publicId: publicIdParam } : {}),
    };

    const rows = await prisma.flow.findMany({
      where,
      orderBy: [{ lastRunAt: 'desc' }, { publicId: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        publicId: true,
        title: true,
        lastRunAt: true,
        latestRunId: true,
        slug: true,
        summary: true,
        visibility: true,
        categoryId: true,
        seoTitle: true,
        seoDescription: true,
        noindex: true,
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    // A flow that has never been compiled has no latestRunId: fall back to its newest
    // run so the list can still flag whether it holds an unredacted step.
    const flowsNeedingNewestRun = page.filter((flow) => flow.latestRunId === null);
    const newestRunByFlow = new Map<string, string>();
    if (flowsNeedingNewestRun.length > 0) {
      const newest = await prisma.$queryRaw<{ flowId: string; runId: string }[]>`
        SELECT DISTINCT ON ("flowId") "flowId", "id" AS "runId"
        FROM "Run"
        WHERE "flowId" IN (${Prisma.join(flowsNeedingNewestRun.map((flow) => flow.id))})
        ORDER BY "flowId", "startedAt" DESC
      `;
      for (const row of newest) newestRunByFlow.set(row.flowId, row.runId);
    }

    const relevantRunId = new Map<string, string>();
    for (const flow of page) {
      const runId = flow.latestRunId ?? newestRunByFlow.get(flow.id);
      if (runId) relevantRunId.set(flow.id, runId);
    }

    const runIds = [...relevantRunId.values()];
    const unredactedByRunId = new Map<string, boolean>();
    const stepCountByRun = new Map<string, number>();
    if (runIds.length > 0) {
      const [runs, counts] = await Promise.all([
        prisma.run.findMany({
          where: { id: { in: runIds } },
          select: { id: true, hasUnredactedStep: true },
        }),
        prisma.step.groupBy({
          by: ['runId'],
          where: { runId: { in: runIds } },
          _count: { _all: true },
        }),
      ]);
      for (const run of runs) unredactedByRunId.set(run.id, run.hasUnredactedStep);
      for (const count of counts) stepCountByRun.set(count.runId, count._count._all);
    }

    // Load categories for the flows
    const categoryIds = new Set(page.map((f) => f.categoryId).filter((id) => id !== null));
    const categoriesById = new Map<string, { id: string; name: string; status: string }>();
    if (categoryIds.size > 0) {
      const categories = await prisma.category.findMany({
        where: { id: { in: [...categoryIds] } },
        select: { id: true, name: true, status: true },
      });
      for (const cat of categories) {
        categoriesById.set(cat.id, cat);
      }
    }

    // Also load suggested categories for the workspace
    const suggestedCategories = await prisma.category.findMany({
      where: { organizationId, status: 'suggested' },
      select: { id: true, name: true, status: true },
    });
    const suggestedCategoriesMap = new Map<string, { id: string; name: string; status: string }>();
    for (const cat of suggestedCategories) {
      suggestedCategoriesMap.set(cat.id, cat);
    }

    const items = page.map((flow) => {
      const runId = relevantRunId.get(flow.id);
      const category = flow.categoryId ? categoriesById.get(flow.categoryId) : null;
      return {
        public_id: flow.publicId,
        title: flow.title,
        last_run_at: flow.lastRunAt.toISOString(),
        url: flow.latestRunId ? docUrl(flow.publicId) : null,
        not_redacted: runId ? (unredactedByRunId.get(runId) ?? false) : false,
        slug: flow.slug,
        summary: flow.summary,
        visibility: flow.visibility,
        steps: runId ? (stepCountByRun.get(runId) ?? 0) : 0,
        seo_title: flow.seoTitle,
        seo_description: flow.seoDescription,
        noindex: flow.noindex,
        category: category ? { id: category.id, name: category.name, status: category.status } : null,
      };
    });

    return status(200, {
      items,
      next_cursor: hasMore ? page[page.length - 1]!.publicId : null,
    });
  },
).delete('/api/v1/flows/:publicId', async ({ params, request, status }) => {
  const organizationId = await resolveOrganizationId(request);
  const prisma = getPrisma();

  const flow = await prisma.flow.findFirst({
    where: { publicId: params.publicId, organizationId },
    select: { id: true },
  });
  if (!flow) throw new ApiError(404, 'not_found', 'Flow not found');

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.flow.updateMany({ where: { id: flow.id, deletedAt: null }, data: { deletedAt: now } });

    await tx.asset.updateMany({
      where: {
        // Defense in depth: steps can only reference own-workspace assets today, but never
        // let this update reach another workspace's rows if that ever changes.
        organizationId,
        deletedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        steps: { some: { run: { flowId: flow.id } } },
      },
      data: { expiresAt: now },
    });
  });

  return status(204);
});
