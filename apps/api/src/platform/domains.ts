import { Elysia } from 'elysia';
import type { Prisma } from '../../generated/prisma/client';
import { getPrisma } from '../db';
import { ApiError } from '../errors';
import { requirePlatformAdmin, requirePlatformStaff } from '../platform-guard';
import { recordAuditLog } from '../audit/audit-log';
import { checkCnameMatch, expectedCnameTarget } from '../site/domain';

const readJson = async (request: Request): Promise<Record<string, unknown>> => {
  const text = await request.text().catch(() => {
    throw new ApiError(422, 'validation_failed', 'A JSON request body is required');
  });
  if (text.trim().length === 0) return {};
  try {
    return (JSON.parse(text) as Record<string, unknown>) ?? {};
  } catch {
    throw new ApiError(422, 'validation_failed', 'Request body must be valid JSON');
  }
};

export const platformDomainsRoute = new Elysia()
  .get('/api/v1/platform/domains', async ({ request, query }) => {
    await requirePlatformStaff(request);
    const prisma = getPrisma();

    const filter = typeof query.filter === 'string' ? query.filter.trim().toLowerCase() : 'all';

    const where: Prisma.WorkspaceSiteWhereInput = {
      customDomain: { not: null },
    };

    if (filter === 'attention') {
      where.domainStatus = { in: ['waiting_dns', 'cert_failing', 'blocked'] };
    }

    const [sites, totalAll] = await Promise.all([
      prisma.workspaceSite.findMany({
        where,
        include: {
          organization: {
            select: { id: true, name: true, slug: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.workspaceSite.count({
        where: { customDomain: { not: null } },
      }),
    ]);

    const domains = sites
      .filter((s) => s.customDomain !== null)
      .map((s) => ({
        domain: s.customDomain!,
        tenant: {
          id: s.organization.id,
          name: s.organization.name,
          slug: s.organization.slug,
        },
        status: (s.domainStatus ?? 'waiting_dns') as 'verified' | 'waiting_dns' | 'cert_failing' | 'blocked',
        cert_expires_at: s.certExpiresAt?.toISOString() ?? null,
        last_checked_at: s.lastCheckedAt?.toISOString() ?? null,
      }));

    return {
      domains,
      total: totalAll,
    };
  })
  .post('/api/v1/platform/domains/:domain/recheck', async ({ request, params }) => {
    await requirePlatformStaff(request);
    const prisma = getPrisma();

    const domainName = decodeURIComponent(params.domain).toLowerCase().trim();
    const site = await prisma.workspaceSite.findUnique({
      where: { customDomain: domainName },
      include: {
        organization: { select: { id: true, slug: true } },
      },
    });

    if (!site || !site.customDomain) {
      throw new ApiError(404, 'not_found', 'Domain not found');
    }

    const target = expectedCnameTarget(site.organization.slug, process.env.TENANT_BASE_DOMAIN ?? '');
    const found = await checkCnameMatch(site.customDomain, target);
    const now = new Date();

    const newStatus = site.domainStatus === 'blocked' ? 'blocked' : found ? 'verified' : 'waiting_dns';

    const updated = await prisma.workspaceSite.update({
      where: { organizationId: site.organizationId },
      data: {
        domainStatus: newStatus,
        lastCheckedAt: now,
      },
    });

    return {
      domain: updated.customDomain,
      status: updated.domainStatus,
      last_checked_at: now.toISOString(),
      cert_expires_at: updated.certExpiresAt?.toISOString() ?? null,
    };
  })
  .post('/api/v1/platform/domains/:domain/block', async ({ request, params }) => {
    const admin = await requirePlatformAdmin(request);
    const body = await readJson(request);

    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) {
      throw new ApiError(422, 'validation_failed', 'A reason is required');
    }

    const prisma = getPrisma();
    const domainName = decodeURIComponent(params.domain).toLowerCase().trim();
    const site = await prisma.workspaceSite.findUnique({
      where: { customDomain: domainName },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
      },
    });

    if (!site || !site.customDomain) {
      throw new ApiError(404, 'not_found', 'Domain not found');
    }

    const updated = await prisma.workspaceSite.update({
      where: { organizationId: site.organizationId },
      data: { domainStatus: 'blocked' },
    });

    await recordAuditLog({
      actorKind: 'staff',
      actorId: admin.userId,
      organizationId: site.organizationId,
      action: `Staff blocked domain ${site.customDomain}`,
      detail: {
        domain: site.customDomain,
        reason,
        actorName: admin.name,
        actorEmail: admin.email,
      },
    });

    return {
      ok: true,
      domain: updated.customDomain,
      status: 'blocked',
    };
  })
  .post('/api/v1/platform/domains/:domain/unblock', async ({ request, params }) => {
    const admin = await requirePlatformAdmin(request);
    const body = await readJson(request);

    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) {
      throw new ApiError(422, 'validation_failed', 'A reason is required');
    }

    const prisma = getPrisma();
    const domainName = decodeURIComponent(params.domain).toLowerCase().trim();
    const site = await prisma.workspaceSite.findUnique({
      where: { customDomain: domainName },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
      },
    });

    if (!site || !site.customDomain) {
      throw new ApiError(404, 'not_found', 'Domain not found');
    }

    const target = expectedCnameTarget(site.organization.slug, process.env.TENANT_BASE_DOMAIN ?? '');
    const found = await checkCnameMatch(site.customDomain, target);
    const newStatus = found ? 'verified' : 'waiting_dns';
    const now = new Date();

    const updated = await prisma.workspaceSite.update({
      where: { organizationId: site.organizationId },
      data: {
        domainStatus: newStatus,
        lastCheckedAt: now,
      },
    });

    await recordAuditLog({
      actorKind: 'staff',
      actorId: admin.userId,
      organizationId: site.organizationId,
      action: `Staff unblocked domain ${site.customDomain}`,
      detail: {
        domain: site.customDomain,
        reason,
        actorName: admin.name,
        actorEmail: admin.email,
      },
    });

    return {
      ok: true,
      domain: updated.customDomain,
      status: newStatus,
      last_checked_at: now.toISOString(),
    };
  });
