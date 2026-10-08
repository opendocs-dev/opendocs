import { Elysia } from 'elysia';
import { FREE_STORAGE_BYTES } from '@opendocs/core';
import { auth } from '../auth';
import { getPrisma } from '../db';
import { ApiError } from '../errors';
import { getPlan } from '../plan';
import { startOfUtcDay } from '../quota';
import { roleFor } from '../site/role';
import { refreshSearchDocument } from '../site/search-doc';

const unauthorized = (message: string) => new ApiError(403, 'unauthorized', message);
const invalid = (message: string) => new ApiError(422, 'validation_failed', message);
const notFound = () => new ApiError(404, 'not_found', 'Not found');
const conflict = (message: string) => new ApiError(409, 'validation_failed', message);

const requireSessionAndMember = async (request: Request) => {
  const session = await auth.api.getSession({ headers: request.headers });
  const organizationId = session?.session.activeOrganizationId;
  if (!session || !organizationId) {
    throw new ApiError(401, 'unauthorized', 'A valid session is required');
  }
  const role = await roleFor(session.user.id, organizationId);
  if (!role) {
    throw new ApiError(403, 'unauthorized', 'You are not a member of this workspace');
  }
  return { userId: session.user.id, organizationId, role };
};

const readJsonBody = async (request: Request): Promise<Record<string, unknown>> => {
  const text = await request.text().catch(() => {
    throw invalid('A JSON request body is required');
  });

  let parsed: unknown = {};
  if (text.trim().length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw invalid('Request body must be valid JSON');
    }
  }

  return (parsed as Record<string, unknown>) ?? {};
};

const siteHostFor = (slug: string): string | null => {
  const base = process.env.TENANT_BASE_DOMAIN;
  return base ? `${slug}.${base}` : null;
};

export const flowsAdminRoute = new Elysia()
  .patch(
    '/api/v1/flows/:publicId',
    async ({ params, request }) => {
      const { organizationId } = await requireSessionAndMember(request);
      const body = await readJsonBody(request);

      const title = body.title;
      const summary = body.summary;
      const visibility = body.visibility;
      const seoTitle = body.seo_title;
      const seoDescription = body.seo_description;
      const noindex = body.noindex;
      const slug = body.slug;

      // At least one field must be present
      if (
        title === undefined &&
        summary === undefined &&
        visibility === undefined &&
        seoTitle === undefined &&
        seoDescription === undefined &&
        noindex === undefined &&
        slug === undefined
      ) {
        throw invalid(
          'At least one of title, summary, visibility, seo_title, seo_description, noindex, or slug must be provided',
        );
      }

      // Validate title if provided
      let finalTitle: string | undefined;
      if (title !== undefined) {
        if (typeof title !== 'string') throw invalid('title must be a string');
        finalTitle = title.trim();
        if (finalTitle.length < 1 || finalTitle.length > 120) {
          throw invalid('title must be between 1 and 120 characters');
        }
      }

      // Validate summary if provided
      let finalSummary: string | null | undefined;
      if (summary !== undefined) {
        if (typeof summary !== 'string') throw invalid('summary must be a string');
        finalSummary = summary.trim() === '' ? null : summary.trim().slice(0, 300);
      }

      // Validate visibility if provided
      if (visibility !== undefined) {
        if (visibility !== 'published' && visibility !== 'unlisted' && visibility !== 'draft') {
          throw invalid('visibility must be "published", "unlisted", or "draft"');
        }
      }

      // Validate seo_title if provided; "" clears back to the title fallback
      let finalSeoTitle: string | null | undefined;
      if (seoTitle !== undefined) {
        if (typeof seoTitle !== 'string') throw invalid('seo_title must be a string');
        const trimmed = seoTitle.trim();
        if (trimmed.length > 60) throw invalid('seo_title must be at most 60 characters');
        finalSeoTitle = trimmed === '' ? null : trimmed;
      }

      // Validate seo_description if provided; "" clears back to the summary fallback
      let finalSeoDescription: string | null | undefined;
      if (seoDescription !== undefined) {
        if (typeof seoDescription !== 'string') throw invalid('seo_description must be a string');
        const trimmed = seoDescription.trim();
        if (trimmed.length > 160) throw invalid('seo_description must be at most 160 characters');
        finalSeoDescription = trimmed === '' ? null : trimmed;
      }

      // Validate noindex if provided
      if (noindex !== undefined && typeof noindex !== 'boolean') {
        throw invalid('noindex must be a boolean');
      }

      // Validate slug if provided
      let finalSlug: string | undefined;
      if (slug !== undefined) {
        if (typeof slug !== 'string') throw invalid('slug must be a string');
        const trimmed = slug.trim().toLowerCase();
        if (trimmed.length < 1 || trimmed.length > 60) {
          throw invalid('slug must be between 1 and 60 characters');
        }
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) {
          throw invalid(
            'slug must contain only lowercase letters, numbers, and hyphens without consecutive hyphens',
          );
        }
        finalSlug = trimmed;
      }

      const prisma = getPrisma();

      const flow = await prisma.flow.findFirst({
        where: { publicId: params.publicId, organizationId, deletedAt: null },
        select: { id: true, title: true, summary: true, latestRunId: true, slug: true },
      });
      if (!flow) throw notFound();

      // Check slug uniqueness within workspace if slug changed
      if (finalSlug !== undefined && finalSlug !== flow.slug) {
        const existing = await prisma.flow.findFirst({
          where: {
            organizationId,
            slug: finalSlug,
            deletedAt: null,
            id: { not: flow.id },
          },
          select: { id: true },
        });
        if (existing) {
          throw conflict('A guide with this address already exists');
        }
      }

      const updateData: Record<string, unknown> = {};
      if (finalTitle !== undefined) updateData.title = finalTitle;
      if (finalSummary !== undefined) updateData.summary = finalSummary;
      if (visibility !== undefined) updateData.visibility = visibility;
      if (finalSlug !== undefined) updateData.slug = finalSlug;
      if (finalSeoTitle !== undefined) updateData.seoTitle = finalSeoTitle;
      if (finalSeoDescription !== undefined) updateData.seoDescription = finalSeoDescription;
      if (noindex !== undefined) updateData.noindex = noindex;

      const titleChanged = finalTitle !== undefined && finalTitle !== flow.title;
      const summaryChanged = finalSummary !== undefined && finalSummary !== flow.summary;

      try {
        await prisma.$transaction(async (tx) => {
          await tx.flow.update({
            where: { id: flow.id },
            data: updateData,
          });

          // Refresh search document if title or summary changed and flow has been compiled
          if ((titleChanged || summaryChanged) && flow.latestRunId) {
            await refreshSearchDocument(tx, flow.id, flow.latestRunId);
          }
        });
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') {
          throw conflict('A guide with this address already exists');
        }
        throw error;
      }

      return { ok: true };
    },
  )
  .post(
    '/api/v1/flows/bulk',
    async ({ request }) => {
      const { organizationId } = await requireSessionAndMember(request);
      const body = await readJsonBody(request);

      const ids = body.ids;
      const categoryId = body.category_id;
      const visibility = body.visibility;

      // Validate ids
      if (!Array.isArray(ids)) throw invalid('ids must be an array');
      if (ids.length < 1 || ids.length > 50) throw invalid('ids must contain 1-50 elements');
      const uniqueIds = new Set(ids);
      if (uniqueIds.size !== ids.length) throw invalid('ids must be unique');
      for (const id of ids) {
        if (typeof id !== 'string') throw invalid('all ids must be strings');
      }

      // At least one of category_id or visibility must be present
      if (categoryId === undefined && visibility === undefined) {
        throw invalid('At least one of category_id or visibility must be provided');
      }

      // Validate category_id if provided
      let finalCategoryId: string | null | undefined;
      if (categoryId !== undefined) {
        if (categoryId === null) {
          finalCategoryId = null;
        } else if (typeof categoryId !== 'string') {
          throw invalid('category_id must be a string or null');
        } else {
          // Check that it exists in the workspace
          const category = await getPrisma().category.findFirst({
            where: { organizationId, id: categoryId },
            select: { id: true },
          });
          if (!category) throw notFound();
          finalCategoryId = categoryId;
        }
      }

      // Validate visibility if provided
      if (visibility !== undefined) {
        if (visibility !== 'published' && visibility !== 'unlisted' && visibility !== 'draft') {
          throw invalid('visibility must be "published", "unlisted", or "draft"');
        }
      }

      const prisma = getPrisma();

      // Check that all flows exist and belong to this workspace, in a transaction
      const updated = await prisma.$transaction(async (tx) => {
        // First, verify all flows exist in this workspace and are not deleted
        const flows = await tx.flow.findMany({
          where: { publicId: { in: [...uniqueIds] }, organizationId, deletedAt: null },
          select: { publicId: true },
        });

        if (flows.length !== uniqueIds.size) {
          throw notFound();
        }

        // Update all flows
        const result = await tx.flow.updateMany({
          where: { publicId: { in: [...uniqueIds] }, organizationId, deletedAt: null },
          data: {
            ...(finalCategoryId !== undefined ? { categoryId: finalCategoryId } : {}),
            ...(visibility !== undefined ? { visibility } : {}),
          },
        });

        return result.count;
      });

      return { updated };
    },
  )
  .get(
    '/api/v1/overview',
    async ({ request }) => {
      const { organizationId } = await requireSessionAndMember(request);
      const prisma = getPrisma();

      const today = startOfUtcDay(new Date());
      const thirtyDaysAgo = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);

      const [
        publishedCount,
        unlistedCount,
        draftCount,
        uncategorizedCount,
        suggestedCount,
        hasKey,
        views30dAgg,
        searches30dAgg,
        plan,
        storageUsage,
      ] = await Promise.all([
        prisma.flow.count({
          where: { organizationId, deletedAt: null, visibility: 'published', latestRunId: { not: null } },
        }),
        prisma.flow.count({
          where: { organizationId, deletedAt: null, visibility: 'unlisted', latestRunId: { not: null } },
        }),
        prisma.flow.count({
          where: { organizationId, deletedAt: null, visibility: 'draft', latestRunId: { not: null } },
        }),
        prisma.flow.count({
          where: { organizationId, deletedAt: null, visibility: 'published', categoryId: null, latestRunId: { not: null } },
        }),
        prisma.category.count({
          where: { organizationId, status: 'suggested' },
        }),
        prisma.apikey.findFirst({
          where: { referenceId: organizationId },
          select: { id: true },
        }),
        prisma.analyticsDaily.aggregate({
          where: {
            flow: { organizationId, deletedAt: null },
            day: { gte: thirtyDaysAgo, lte: today },
          },
          _sum: { views: true },
        }),
        prisma.searchLog.aggregate({
          where: {
            organizationId,
            day: { gte: thirtyDaysAgo, lte: today },
          },
          _sum: { times: true },
        }),
        getPlan(organizationId),
        prisma.asset.aggregate({
          where: {
            organizationId,
            kind: 'step',
            deletedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          _sum: { bytes: true },
        }),
      ]);

      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { slug: true },
      });
      if (!organization) throw notFound();

      const hasGuide = publishedCount + unlistedCount + draftCount > 0;
      const siteHost = siteHostFor(organization.slug);

      const liveBytes = storageUsage._sum.bytes ?? 0;
      let storageUsed = '0%';
      if (plan === 'free') {
        const percent = Math.min(100, Math.round((Number(liveBytes) / FREE_STORAGE_BYTES) * 100));
        storageUsed = `${percent}%`;
      }

      return {
        published: publishedCount,
        unlisted: unlistedCount,
        draft: draftCount,
        uncategorized: uncategorizedCount,
        suggested_categories: suggestedCount,
        has_key: hasKey !== null,
        has_guide: hasGuide,
        site_host: siteHost,
        views_30d: views30dAgg._sum.views ?? 0,
        searches: searches30dAgg._sum.times ?? 0,
        storage_used: storageUsed,
      };
    },
  );
