import { Elysia } from 'elysia';
import type { Prisma } from '../../generated/prisma/client';
import { getPrisma } from '../db';
import { ApiError } from '../errors';
import { requirePlatformAdmin, requirePlatformStaff } from '../platform-guard';
import { recordAuditLog } from '../audit/audit-log';

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

const parsePage = (raw: unknown): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
};

const parseLimit = (raw: unknown): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 100) : 20;
};

export const platformTenantsRoute = new Elysia()
  .get('/api/v1/platform/tenants', async ({ request, query }) => {
    await requirePlatformStaff(request);
    const prisma = getPrisma();

    const q = typeof query.q === 'string' ? query.q.trim() : '';
    const plan = typeof query.plan === 'string' ? query.plan.trim().toLowerCase() : '';
    const page = parsePage(query.page);
    const limit = parseLimit(query.limit);

    const conditions: Prisma.OrganizationWhereInput[] = [];

    if (q.length > 0) {
      conditions.push({
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q, mode: 'insensitive' } },
        ],
      });
    }

    if (plan === 'free') {
      conditions.push({
        OR: [{ billing: null }, { billing: { plan: 'free' } }],
      });
    } else if (plan === 'pro' || plan === 'enterprise') {
      conditions.push({
        billing: { plan },
      });
    }

    const where: Prisma.OrganizationWhereInput = conditions.length > 0 ? { AND: conditions } : {};

    const total = await prisma.organization.count({ where });

    const orgs = await prisma.organization.findMany({
      where,
      include: {
        billing: { select: { plan: true } },
        site: { select: { customDomain: true, domainStatus: true } },
        _count: {
          select: {
            flows: { where: { deletedAt: null } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const orgIds = orgs.map((o) => o.id);
    const assetAggs =
      orgIds.length > 0
        ? await prisma.asset.groupBy({
            by: ['organizationId'],
            where: {
              organizationId: { in: orgIds },
              deletedAt: null,
            },
            _sum: { bytes: true },
          })
        : [];

    const storageMap = new Map(assetAggs.map((a) => [a.organizationId, a._sum.bytes ?? 0]));
    const baseDomain = process.env.TENANT_BASE_DOMAIN || 'example.com';

    const tenants = orgs.map((org) => {
      const tenantPlan =
        org.billing?.plan && ['free', 'pro', 'enterprise'].includes(org.billing.plan)
          ? org.billing.plan
          : 'free';
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        address: `${org.slug}.${baseDomain}`,
        plan: tenantPlan,
        guides_count: org._count.flows,
        storage_bytes: storageMap.get(org.id) ?? 0,
        status: org.suspendedAt ? ('suspended' as const) : ('active' as const),
        created_at: org.createdAt.toISOString(),
        suspended_at: org.suspendedAt?.toISOString() ?? null,
      };
    });

    return {
      tenants,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit) || 1,
    };
  })
  .get('/api/v1/platform/tenants/:slug', async ({ request, params }) => {
    await requirePlatformStaff(request);
    const prisma = getPrisma();

    const rawSlug = params.slug?.toLowerCase();
    if (!rawSlug) throw new ApiError(404, 'not_found', 'Tenant not found');

    const org = await prisma.organization.findUnique({
      where: { slug: rawSlug },
      include: {
        billing: true,
        site: true,
        aiAssistant: true,
        _count: {
          select: {
            flows: { where: { deletedAt: null } },
          },
        },
      },
    });

    if (!org) throw new ApiError(404, 'not_found', 'Tenant not found');

    const storageAgg = await prisma.asset.aggregate({
      where: { organizationId: org.id, deletedAt: null },
      _sum: { bytes: true },
    });
    const storageBytes = storageAgg._sum.bytes ?? 0;

    const latestLedger = await prisma.aiCreditLedger.findFirst({
      where: { organizationId: org.id },
      orderBy: { createdAt: 'desc' },
    });
    const balance = latestLedger?.balanceAfter ?? 0;

    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthlyCharges = await prisma.aiCreditLedger.aggregate({
      where: {
        organizationId: org.id,
        delta: { lt: 0 },
        createdAt: { gte: startOfMonth },
      },
      _sum: { delta: true },
    });
    const usedThisMonth = Math.abs(monthlyCharges._sum.delta ?? 0);

    const auditLogs = await prisma.auditLog.findMany({
      where: { organizationId: org.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const actorUserIds = Array.from(
      new Set(
        auditLogs
          .filter((l) => l.actorKind === 'staff' || l.actorKind === 'user')
          .map((l) => l.actorId),
      ),
    );

    const users = await prisma.user.findMany({
      where: { id: { in: actorUserIds } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const formattedAuditLogs = auditLogs.map((log) => {
      const actor = userMap.get(log.actorId);
      const detailObj =
        typeof log.detail === 'object' && log.detail !== null
          ? (log.detail as Record<string, unknown>)
          : {};
      return {
        id: log.id,
        created_at: log.createdAt.toISOString(),
        actor_kind: log.actorKind,
        actor_id: log.actorId,
        actor_name:
          actor?.name ?? (detailObj.actorName as string) ?? (log.actorKind === 'staff' ? 'Staff' : 'User'),
        actor_email: actor?.email ?? (detailObj.actorEmail as string) ?? null,
        action: log.action,
        detail: detailObj,
      };
    });

    const tenantPlan =
      org.billing?.plan && ['free', 'pro', 'enterprise'].includes(org.billing.plan)
        ? org.billing.plan
        : 'free';
    const baseDomain = process.env.TENANT_BASE_DOMAIN || 'example.com';

    return {
      tenant: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        address: `${org.slug}.${baseDomain}`,
        created_at: org.createdAt.toISOString(),
        suspended_at: org.suspendedAt?.toISOString() ?? null,
        status: org.suspendedAt ? ('suspended' as const) : ('active' as const),
        plan: tenantPlan,
        guides_count: org._count.flows,
        storage_bytes: storageBytes,
        domain: {
          primary: `${org.slug}.${baseDomain}`,
          custom_domain: org.site?.customDomain ?? null,
          domain_status: org.site?.domainStatus ?? null,
          cert_expires_at: org.site?.certExpiresAt?.toISOString() ?? null,
          last_checked_at: org.site?.lastCheckedAt?.toISOString() ?? null,
        },
        ai_credits: {
          balance,
          used_this_month: usedThisMonth,
          monthly_limit: tenantPlan === 'enterprise' ? 10000 : tenantPlan === 'pro' ? 2500 : 0,
          model: org.aiAssistant?.modelId ?? 'GPT Luna',
          byo_set: Boolean(org.aiAssistant?.byoEnabled && org.aiAssistant?.byoSecret),
        },
        audit_logs: formattedAuditLogs,
      },
    };
  })
  .post('/api/v1/platform/tenants/:slug/plan', async ({ request, params }) => {
    const admin = await requirePlatformAdmin(request);
    const body = await readJson(request);

    const rawSlug = params.slug?.toLowerCase();
    const prisma = getPrisma();
    const org = await prisma.organization.findUnique({
      where: { slug: rawSlug },
      include: { billing: true },
    });
    if (!org) throw new ApiError(404, 'not_found', 'Tenant not found');

    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) {
      throw new ApiError(422, 'validation_failed', 'A reason is required');
    }

    const newPlan = typeof body.plan === 'string' ? body.plan.trim().toLowerCase() : '';
    if (!['free', 'pro', 'enterprise'].includes(newPlan)) {
      throw new ApiError(422, 'validation_failed', 'Plan must be "free", "pro", or "enterprise"');
    }

    const oldPlan =
      org.billing?.plan && ['free', 'pro', 'enterprise'].includes(org.billing.plan)
        ? org.billing.plan
        : 'free';

    await prisma.workspaceBilling.upsert({
      where: { organizationId: org.id },
      create: { organizationId: org.id, plan: newPlan },
      update: { plan: newPlan },
    });

    await recordAuditLog({
      actorKind: 'staff',
      actorId: admin.userId,
      organizationId: org.id,
      action: `Staff changed plan from ${oldPlan} to ${newPlan}`,
      detail: {
        actorName: admin.name,
        actorEmail: admin.email,
        previousPlan: oldPlan,
        newPlan,
        reason,
      },
    });

    return { ok: true, plan: newPlan };
  })
  .post('/api/v1/platform/tenants/:slug/suspend', async ({ request, params }) => {
    const admin = await requirePlatformAdmin(request);
    const body = await readJson(request);

    const rawSlug = params.slug?.toLowerCase();
    const prisma = getPrisma();
    const org = await prisma.organization.findUnique({
      where: { slug: rawSlug },
    });
    if (!org) throw new ApiError(404, 'not_found', 'Tenant not found');

    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) {
      throw new ApiError(422, 'validation_failed', 'A reason is required');
    }

    const action = body.action;
    if (action !== 'suspend' && action !== 'restore') {
      throw new ApiError(422, 'validation_failed', 'Action must be "suspend" or "restore"');
    }

    const isSuspend = action === 'suspend';
    await prisma.organization.update({
      where: { id: org.id },
      data: { suspendedAt: isSuspend ? new Date() : null },
    });

    await recordAuditLog({
      actorKind: 'staff',
      actorId: admin.userId,
      organizationId: org.id,
      action: isSuspend ? 'Staff suspended tenant' : 'Staff restored tenant',
      detail: {
        actorName: admin.name,
        actorEmail: admin.email,
        action,
        reason,
      },
    });

    return { ok: true, status: isSuspend ? 'suspended' : 'active' };
  })
  .post('/api/v1/platform/tenants/:slug/credits', async ({ request, params }) => {
    const admin = await requirePlatformAdmin(request);
    const body = await readJson(request);

    const rawSlug = params.slug?.toLowerCase();
    const prisma = getPrisma();
    const org = await prisma.organization.findUnique({
      where: { slug: rawSlug },
    });
    if (!org) throw new ApiError(404, 'not_found', 'Tenant not found');

    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) {
      throw new ApiError(422, 'validation_failed', 'A reason is required');
    }

    const credits = Number(body.credits);
    if (!Number.isInteger(credits) || credits <= 0) {
      throw new ApiError(422, 'validation_failed', 'Credits must be a positive integer');
    }

    const latest = await prisma.aiCreditLedger.findFirst({
      where: { organizationId: org.id },
      orderBy: { createdAt: 'desc' },
    });
    const currentBalance = latest?.balanceAfter ?? 0;
    const balanceAfter = currentBalance + credits;

    await prisma.aiCreditLedger.create({
      data: {
        organizationId: org.id,
        delta: credits,
        reason: 'admin_grant',
        messageId: `grant-${crypto.randomUUID()}`,
        credits,
        balanceAfter,
      },
    });

    await recordAuditLog({
      actorKind: 'staff',
      actorId: admin.userId,
      organizationId: org.id,
      action: `Staff granted ${credits} AI credits`,
      detail: {
        actorName: admin.name,
        actorEmail: admin.email,
        credits,
        reason,
        balanceAfter,
      },
    });

    return { ok: true, balance: balanceAfter, granted: credits };
  });
