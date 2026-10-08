import { Elysia } from 'elysia';
import type { Prisma } from '../../generated/prisma/client';
import { getPrisma } from '../db';
import { getEnv } from '../env';
import { ApiError } from '../errors';
import { assetUrl } from '../asset-url';
import { getInstanceOrg } from '../instance-org';
import { toDocStep } from '../routes/docs';
import { hasMemberSession } from './session';
import { recordHelpfulVote, recordSearch, recordView } from '../analytics/events';
import {
  getPublicAssistantConfig,
  processChat,
  voteChatMessage,
} from '../assistant/chat-service';

/** Every unknown/draft/deleted/unlisted-by-list case answers with this one body. */
const notFound = () => new ApiError(404, 'not_found', 'Not found');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_OFFSET = 1_000_000;
const SUMMARY_CUT = 160;

const CACHE_CONTROL = 'public, max-age=30';

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/`/g, '');
}

const parseLimit = (raw: string | undefined): number => {
  if (raw === undefined || !/^\d+$/.test(raw)) return DEFAULT_LIMIT;
  const value = Number(raw);
  if (value < 1) return DEFAULT_LIMIT;
  return Math.min(value, MAX_LIMIT);
};

const parseOffset = (raw: string | undefined): number => {
  if (raw === undefined || !/^\d+$/.test(raw)) return 0;
  return Math.min(Number(raw), MAX_OFFSET);
};

/** Falls back to the first step's instruction (cut at 160 chars) when the flow has no summary. */
const summaryFor = (summary: string | null, firstStepInstruction: string | null): string => {
  if (summary) return summary;
  if (!firstStepInstruction) return '';
  if (firstStepInstruction.length <= SUMMARY_CUT) return firstStepInstruction;
  return `${firstStepInstruction.slice(0, SUMMARY_CUT)}…`;
};

/** The public API serves the one instance workspace; there is no slug in the path (C23 AC-11). */
const requireWorkspace = async (): Promise<string> => (await getInstanceOrg()).id;

const listedGuidesWhere = (organizationId: string): Prisma.FlowWhereInput => ({
  organizationId,
  deletedAt: null,
  visibility: 'published',
  latestRunId: { not: null },
});

export const publicRoute = new Elysia()
  .get('/api/v1/site/categories', async ({ set }) => {
    set.headers['cache-control'] = CACHE_CONTROL;
    const organizationId = await requireWorkspace();
    const prisma = getPrisma();

    const listedWhere = listedGuidesWhere(organizationId);
    const [counts, categories, topGuides] = await Promise.all([
      prisma.flow.groupBy({
        by: ['categoryId'],
        where: { ...listedWhere, categoryId: { not: null } },
        _count: { _all: true },
      }),
      prisma.category.findMany({
        where: { organizationId, status: 'active' },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
        select: { slug: true, name: true, description: true, id: true },
      }),
      prisma.flow.findMany({
        where: { ...listedWhere, categoryId: { not: null } },
        orderBy: { lastRunAt: 'desc' },
        select: { slug: true, title: true, categoryId: true },
      }),
    ]);

    const countByCategory = new Map(counts.map((row) => [row.categoryId, row._count._all]));

    return {
      categories: categories
        .map((cat) => ({
          slug: cat.slug,
          name: cat.name,
          description: cat.description,
          guides: countByCategory.get(cat.id) ?? 0,
          sample_guides: topGuides
            .filter((g) => g.categoryId === cat.id && g.slug)
            .slice(0, 2)
            .map((g) => ({ slug: g.slug!, title: g.title })),
        }))
        .filter((cat) => cat.guides > 0),
    };
  })
  .get('/api/v1/site/info', async ({ set }) => {
    set.headers['cache-control'] = CACHE_CONTROL;
    const organizationId = await requireWorkspace();
    const prisma = getPrisma();

    const [organization, site, guides, assistantConfig] = await Promise.all([
      prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } }),
      prisma.siteSettings.findUnique({
        where: { organizationId },
        include: { faviconAsset: true, ogAsset: true },
      }),
      prisma.flow.count({ where: listedGuidesWhere(organizationId) }),
      getPublicAssistantConfig(),
    ]);

    return {
      title: site?.siteTitle ?? organization.name,
      tagline: site?.tagline ?? '',
      description: site?.description ?? '',
      preset: site?.preset ?? 'sage',
      accent: site?.accent ?? null,
      mark: site?.mark ?? null,
      font: site?.font ?? null,
      radius: site?.radius ?? null,
      indexing: site?.indexing ?? true,
      guides,
      favicon_url: site?.faviconAsset ? assetUrl(site.faviconAsset) : null,
      og_image_url: site?.ogAsset ? assetUrl(site.ogAsset) : null,
      assistant: assistantConfig.enabled ? assistantConfig : null,
    };
  })
  .get('/api/v1/site/guides', async ({ query, set }) => {
    set.headers['cache-control'] = CACHE_CONTROL;
    const organizationId = await requireWorkspace();
    const limit = parseLimit(query.limit as string | undefined);
    const offset = parseOffset(query.offset as string | undefined);
    const prisma = getPrisma();

    let where = listedGuidesWhere(organizationId);

    // Handle optional category filter
    if (query.category) {
      const categorySlug = (query.category as string).toLowerCase();
      const category = await prisma.category.findUnique({
        where: { organizationId_slug: { organizationId, slug: categorySlug } },
        select: { id: true, status: true },
      });
      if (!category || category.status !== 'active') {
        return { guides: [], total: 0 };
      }
      where = { ...where, categoryId: category.id };
    }

    const [flows, total] = await Promise.all([
      prisma.flow.findMany({
        where,
        orderBy: { lastRunAt: 'desc' },
        skip: offset,
        take: limit,
        select: {
          slug: true,
          title: true,
          summary: true,
          lastRunAt: true,
          latestRunId: true,
          noindex: true,
          category: { select: { slug: true, name: true, status: true } },
        },
      }),
      prisma.flow.count({ where }),
    ]);

    const runIds = flows.map((flow) => flow.latestRunId!);
    const [counts, firstSteps] = await Promise.all([
      runIds.length > 0
        ? prisma.step.groupBy({ by: ['runId'], where: { runId: { in: runIds }, hidden: false }, _count: { _all: true } })
        : Promise.resolve([]),
      runIds.length > 0
        ? prisma.step.findMany({
            where: { runId: { in: runIds }, hidden: false },
            orderBy: { order: 'asc' },
            distinct: ['runId'],
            select: { runId: true, instruction: true },
          })
        : Promise.resolve([]),
    ]);

    const countByRun = new Map(counts.map((row) => [row.runId, row._count._all]));
    const firstInstructionByRun = new Map(firstSteps.map((row) => [row.runId, row.instruction]));

    return {
      guides: flows.map((flow) => ({
        slug: flow.slug!,
        title: flow.title,
        summary: summaryFor(flow.summary, firstInstructionByRun.get(flow.latestRunId!) ?? null),
        updated_at: flow.lastRunAt.toISOString(),
        steps: countByRun.get(flow.latestRunId!) ?? 0,
        noindex: flow.noindex,
        category: flow.category && flow.category.status === 'active'
          ? { slug: flow.category.slug, name: flow.category.name }
          : null,
      })),
      total,
    };
  })
  .get('/api/v1/site/search', async ({ query, set }) => {
    set.headers['cache-control'] = CACHE_CONTROL;
    const organizationId = await requireWorkspace();

    const raw = typeof query.q === 'string' ? query.q : '';
    const trimmed = raw.trim().slice(0, 100);
    if (trimmed === '') return { results: [], counts: [] };

    // Splitting on runs of non letter/number already leaves each token as letters/numbers only.
    const words = trimmed.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 0);
    if (words.length === 0) return { results: [], counts: [] };

    const tsQuery = words.map((word) => `${word}:*`).join(' & ');
    const prisma = getPrisma();

    // Handle optional category filter
    let categorySlug: string | null = null;
    let categoryId: string | null = null;
    if (query.category) {
      categorySlug = (query.category as string).toLowerCase();
      const category = await prisma.category.findUnique({
        where: { organizationId_slug: { organizationId, slug: categorySlug } },
        select: { id: true, status: true },
      });
      if (!category || category.status !== 'active') {
        return { results: [], counts: [] };
      }
      categoryId = category.id;
    }

    // tsQuery is built only from sanitized alphanumeric words, but it is still passed as a
    // bound parameter (never string-concatenated into the SQL text) for defense in depth.
    const results = await prisma.$queryRaw<
      Array<{ id: string; slug: string; title: string; summary: string | null; steps: number | null; snippet: string; categorySlug: string | null; categoryName: string | null }>
    >`
      SELECT
        f.id AS id,
        f.slug AS slug,
        f.title AS title,
        f.summary AS summary,
        (
          SELECT count(*)::int
          FROM "Step" s
          WHERE s."runId" = f."latestRunId"
            AND s."hidden" = false
        ) AS steps,
        ts_headline(
          'simple',
          COALESCE(
            (
              SELECT coalesce(s.title, '') || ' ' || s.instruction
              FROM "Step" s
              WHERE s."runId" = f."latestRunId"
                AND s."hidden" = false
                AND to_tsvector('simple', coalesce(s.title, '') || ' ' || s.instruction)
                  @@ to_tsquery('simple', ${tsQuery})
              ORDER BY s."order" ASC
              LIMIT 1
            ),
            f.summary,
            f.title
          ),
          to_tsquery('simple', ${tsQuery}),
          'MaxWords=25,MinWords=10,StartSel=[[,StopSel=]]'
        ) AS snippet,
        c.slug AS "categorySlug",
        c.name AS "categoryName"
      FROM "Flow" f
      LEFT JOIN "Category" c ON c.id = f."categoryId" AND c.status = 'active'
      WHERE f."organizationId" = ${organizationId}
        AND f."deletedAt" IS NULL
        AND f.visibility = 'published'
        AND f."latestRunId" IS NOT NULL
        AND f.search @@ to_tsquery('simple', ${tsQuery})
        AND (${categoryId}::text IS NULL OR f."categoryId" = ${categoryId})
      ORDER BY ts_rank(f.search, to_tsquery('simple', ${tsQuery})) DESC, f."lastRunAt" DESC
      LIMIT 20
    `;

    // Query counts for all active categories matching the search, without category filter
    const counts = await prisma.$queryRaw<
      Array<{ slug: string; name: string; count: number }>
    >`
      SELECT c.slug AS slug, c.name AS name, count(*)::int AS count
      FROM "Flow" f
      JOIN "Category" c ON c.id = f."categoryId"
      WHERE f."organizationId" = ${organizationId}
        AND f."deletedAt" IS NULL
        AND f.visibility = 'published'
        AND f."latestRunId" IS NOT NULL
        AND c.status = 'active'
        AND f.search @@ to_tsquery('simple', ${tsQuery})
      GROUP BY c.slug, c.name, c."position"
      ORDER BY c."position" ASC, c.name ASC
    `;

    await recordSearch(
      organizationId,
      trimmed,
      results.length,
      results.map((r) => r.id),
    );

    return {
      results: results.map((r) => ({
        slug: r.slug,
        title: r.title,
        summary: r.summary,
        snippet: stripMarkdown(r.snippet),
        steps: r.steps ?? 0,
        category: r.categorySlug && r.categoryName ? { slug: r.categorySlug, name: r.categoryName } : null,
      })),
      counts,
    };
  })
  .get('/api/v1/site/guides/:guideSlug', async ({ params, set, request }) => {
    // Drafts are readable by signed-in members only, so those responses must not be cached publicly.
    const member = await hasMemberSession(request);
    set.headers['cache-control'] = member ? 'private, no-store' : CACHE_CONTROL;
    const organizationId = await requireWorkspace();
    const prisma = getPrisma();

    const flow = await prisma.flow.findFirst({
      where: {
        organizationId,
        slug: params.guideSlug,
        deletedAt: null,
        latestRunId: { not: null },
        visibility: { in: member ? ['published', 'unlisted', 'draft'] : ['published', 'unlisted'] },
      },
      select: {
        id: true,
        publicId: true,
        title: true,
        slug: true,
        summary: true,
        visibility: true,
        lastRunAt: true,
        latestRunId: true,
        organizationId: true,
        seoTitle: true,
        seoDescription: true,
        noindex: true,
        category: { select: { slug: true, name: true, status: true } },
      },
    });
    if (!flow) throw notFound();

    if (flow.visibility !== 'published' || flow.noindex) set.headers['x-robots-tag'] = 'noindex';

    const steps = await prisma.step.findMany({
      where: { runId: flow.latestRunId!, hidden: false },
      orderBy: { order: 'asc' },
      include: { asset: true },
    });

    const listedWhere = listedGuidesWhere(organizationId);
    const [prevRow, nextRow] = await Promise.all([
      // "prev" is the newer neighbour: the row right before this one in lastRunAt-desc order.
      prisma.flow.findFirst({
        where: {
          ...listedWhere,
          OR: [{ lastRunAt: { gt: flow.lastRunAt } }, { lastRunAt: flow.lastRunAt, id: { gt: flow.id } }],
        },
        orderBy: [{ lastRunAt: 'asc' }, { id: 'asc' }],
        select: { slug: true, title: true },
      }),
      // "next" is the older neighbour: the row right after this one in lastRunAt-desc order.
      prisma.flow.findFirst({
        where: {
          ...listedWhere,
          OR: [{ lastRunAt: { lt: flow.lastRunAt } }, { lastRunAt: flow.lastRunAt, id: { lt: flow.id } }],
        },
        orderBy: [{ lastRunAt: 'desc' }, { id: 'desc' }],
        select: { slug: true, title: true },
      }),
    ]);

    return {
      public_id: flow.publicId,
      title: flow.title,
      steps: steps.map((step, index) => toDocStep({ ...step, order: index + 1 })),
      slug: flow.slug!,
      summary: summaryFor(flow.summary, steps[0]?.instruction ?? null),
      visibility: flow.visibility,
      updated_at: flow.lastRunAt.toISOString(),
      seo_title: flow.seoTitle,
      seo_description: flow.seoDescription,
      noindex: flow.noindex,
      category: flow.category && flow.category.status === 'active'
        ? { slug: flow.category.slug, name: flow.category.name }
        : null,
      prev: prevRow ? { slug: prevRow.slug!, title: prevRow.title } : null,
      next: nextRow ? { slug: nextRow.slug!, title: nextRow.title } : null,
    };
  })
  .post('/api/v1/site/guides/:guideSlug/view', async ({ params }) => {
    const organizationId = await requireWorkspace();
    const prisma = getPrisma();
    const flow = await prisma.flow.findFirst({
      where: {
        organizationId,
        slug: params.guideSlug,
        deletedAt: null,
        latestRunId: { not: null },
        visibility: { in: ['published', 'unlisted'] },
      },
      select: { id: true },
    });
    if (!flow) throw notFound();

    await recordView(flow.id);
    return { ok: true };
  })
  .post('/api/v1/site/guides/:guideSlug/vote', async ({ params, body }) => {
    const organizationId = await requireWorkspace();
    const prisma = getPrisma();
    const flow = await prisma.flow.findFirst({
      where: {
        organizationId,
        slug: params.guideSlug,
        deletedAt: null,
        latestRunId: { not: null },
        visibility: { in: ['published', 'unlisted'] },
      },
      select: { id: true },
    });
    if (!flow) throw notFound();

    const isObject = typeof body === 'object' && body !== null;
    const helpful = isObject && 'helpful' in body && typeof body.helpful === 'boolean'
      ? body.helpful
      : null;
    if (helpful === null) {
      throw new ApiError(422, 'validation_failed', 'helpful must be a boolean');
    }

    await recordHelpfulVote(flow.id, helpful);
    return { ok: true };
  })
  /**
   * Public and unauthenticated: the reader URL of a published doc on this instance. 404
   * (the same shared body) whenever the doc has no reachable reader page, so this never
   * reveals more than the /api/v1/docs/:publicId route does.
   */
  .get('/api/v1/docs/:publicId/canonical', async ({ params, set }) => {
    set.headers['cache-control'] = CACHE_CONTROL;

    const flow = await getPrisma().flow.findFirst({
      where: {
        publicId: params.publicId,
        deletedAt: null,
        latestRunId: { not: null },
        visibility: 'published',
        slug: { not: null },
      },
      select: { slug: true },
    });
    if (!flow || !flow.slug) throw notFound();

    return { url: `${getEnv().publicUrl}/g/${flow.slug}` };
  })
  .get('/api/v1/site/assistant', async ({ set }) => {
    set.headers['cache-control'] = CACHE_CONTROL;
    return getPublicAssistantConfig();
  })
  .post('/api/v1/site/chat', async ({ body, request }) => {
    if (!getEnv().ai.enabled) throw notFound();
    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('cf-connecting-ip')?.trim() ||
      '127.0.0.1';

    const isObject = typeof body === 'object' && body !== null;
    const rawVisitor =
      isObject && 'visitor_id' in body
        ? body.visitor_id
        : isObject && 'visitorId' in body
          ? body.visitorId
          : undefined;

    let visitorId = 'anon';
    if (rawVisitor !== undefined) {
      if (
        typeof rawVisitor !== 'string' ||
        rawVisitor.length === 0 ||
        rawVisitor.length > 64 ||
        !/^[A-Za-z0-9_-]+$/.test(rawVisitor)
      ) {
        throw new ApiError(
          422,
          'validation_failed',
          'visitor_id must be 1-64 characters matching [A-Za-z0-9_-]',
        );
      }
      visitorId = rawVisitor;
    }

    const visitorKey = `${clientIp}:${visitorId}`;

    const rawMessage = isObject && 'message' in body ? body.message : '';
    if (typeof rawMessage !== 'string' || !rawMessage.trim()) {
      throw new ApiError(422, 'validation_failed', 'Message cannot be empty');
    }
    if (rawMessage.length > 1000) {
      throw new ApiError(422, 'validation_failed', 'Message cannot exceed 1000 characters');
    }

    const conversationId =
      isObject && 'conversation_id' in body && typeof body.conversation_id === 'string'
        ? body.conversation_id
        : isObject && 'conversationId' in body && typeof body.conversationId === 'string'
          ? body.conversationId
          : undefined;

    return processChat(rawMessage, visitorKey, conversationId);
  })
  .post('/api/v1/site/chat/:messageId/vote', async ({ params, body, request }) => {
    if (!getEnv().ai.enabled) throw notFound();
    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('cf-connecting-ip')?.trim() ||
      '127.0.0.1';

    const isObject = typeof body === 'object' && body !== null;
    const rawVisitor =
      isObject && 'visitor_id' in body
        ? body.visitor_id
        : isObject && 'visitorId' in body
          ? body.visitorId
          : undefined;

    let visitorId = 'anon';
    if (rawVisitor !== undefined) {
      if (
        typeof rawVisitor !== 'string' ||
        rawVisitor.length === 0 ||
        rawVisitor.length > 64 ||
        !/^[A-Za-z0-9_-]+$/.test(rawVisitor)
      ) {
        throw new ApiError(
          422,
          'validation_failed',
          'visitor_id must be 1-64 characters matching [A-Za-z0-9_-]',
        );
      }
      visitorId = rawVisitor;
    }

    const visitorKey = `${clientIp}:${visitorId}`;

    let helpful = true;
    if (isObject && 'helpful' in body && typeof body.helpful === 'boolean') {
      helpful = body.helpful;
    } else if (isObject && 'rating' in body && typeof body.rating === 'string') {
      helpful = body.rating === 'helpful';
    }

    let feedback: string | undefined;
    if (isObject && 'feedback' in body && body.feedback !== undefined) {
      if (typeof body.feedback !== 'string') {
        throw new ApiError(422, 'validation_failed', 'Feedback must be a string');
      }
      if (body.feedback.length > 500) {
        throw new ApiError(422, 'validation_failed', 'Feedback cannot exceed 500 characters');
      }
      feedback = body.feedback;
    }

    return voteChatMessage(params.messageId, visitorKey, helpful, feedback);
  });
