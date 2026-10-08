import { Elysia } from 'elysia';
import type { Prisma } from '../../generated/prisma/client';
import { getPrisma } from '../db';
import { ApiError } from '../errors';
import { requirePlatformAdmin, requirePlatformStaff } from '../platform-guard';
import { recordAuditLog } from '../audit/audit-log';

const VALID_TYPES = ['phishing', 'copyright', 'personal_data', 'spam', 'other'] as const;
type ReportType = (typeof VALID_TYPES)[number];

const VALID_STATUSES = ['new', 'in_review', 'actioned', 'dismissed'] as const;
type ReportStatus = (typeof VALID_STATUSES)[number];

// Simple in-memory rate limiting for public report submissions (max 20 per IP per 10 minutes)
const ipSubmissionTimestamps = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const MAX_SUBMISSIONS_PER_WINDOW = 20;

export const _resetRateLimitsForTesting = () => {
  ipSubmissionTimestamps.clear();
};

const checkRateLimit = (ip: string) => {
  const now = Date.now();
  const timestamps = (ipSubmissionTimestamps.get(ip) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  );
  if (timestamps.length >= MAX_SUBMISSIONS_PER_WINDOW) {
    throw new ApiError(429, 'quota_exceeded', 'Too many reports submitted. Please try again later.');
  }
  timestamps.push(now);
  ipSubmissionTimestamps.set(ip, timestamps);
};

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

export const maskEmail = (email: string | null | undefined): string | null => {
  if (!email) return null;
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const name = parts[0]!;
  const domain = parts[1]!;
  const first = name.length > 0 ? name[0] : '*';
  return `${first}***@${domain}`;
};

export const parseGuideAddress = (
  rawInput: string,
): {
  guideAddress: string;
  hostOrTenant: string | null;
  guideSlug: string | null;
} => {
  const trimmed = rawInput.trim();
  let clean = trimmed.replace(/^https?:\/\//i, '');
  clean = clean.replace(/\/+$/, '');

  // Patterns like:
  // acme.opendocs.xxx/g/top-up-balance
  // localhost:3000/tenant/acme/g/top-up-balance
  // /g/claim-prize
  const tenantGMatch = clean.match(/(?:tenant\/([^/]+)\/g\/([^/?#]+))/i);
  if (tenantGMatch) {
    return {
      guideAddress: clean,
      hostOrTenant: tenantGMatch[1] ?? null,
      guideSlug: tenantGMatch[2] ?? null,
    };
  }

  const hostGMatch = clean.match(/^([^/]+)\/g\/([^/?#]+)/i);
  if (hostGMatch) {
    return {
      guideAddress: clean,
      hostOrTenant: hostGMatch[1] ?? null,
      guideSlug: hostGMatch[2] ?? null,
    };
  }

  const bareGMatch = clean.match(/^\/?g\/([^/?#]+)/i);
  if (bareGMatch) {
    return {
      guideAddress: clean,
      hostOrTenant: null,
      guideSlug: bareGMatch[1] ?? null,
    };
  }

  const slashParts = clean.split('/');
  if (slashParts.length === 2 && slashParts[0] && slashParts[1]) {
    return {
      guideAddress: clean,
      hostOrTenant: slashParts[0],
      guideSlug: slashParts[1],
    };
  }

  return {
    guideAddress: clean,
    hostOrTenant: null,
    guideSlug: clean || null,
  };
};

export const normalizeReportType = (raw: unknown): ReportType => {
  if (typeof raw !== 'string') return 'other';
  const lower = raw.trim().toLowerCase().replace(/[-\s]/g, '_');
  if ((VALID_TYPES as readonly string[]).includes(lower)) {
    return lower as ReportType;
  }
  return 'other';
};

export const platformReportsRoute = new Elysia()
  // Public report submission endpoint
  .post('/api/v1/public/reports', async ({ request }) => {
    const clientIp =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('cf-connecting-ip') ??
      '127.0.0.1';
    checkRateLimit(clientIp);

    const body = await readJson(request);

    // Honeypot protection: if a bot fills in any honeypot trap field, silently discard
    const honeypot =
      (typeof body.website === 'string' ? body.website.trim() : '') ||
      (typeof body.honeypot === 'string' ? body.honeypot.trim() : '') ||
      (typeof body.hp === 'string' ? body.hp.trim() : '');
    if (honeypot) {
      return {
        ok: true,
        id: 'sp-ignored',
        status: 'new',
      };
    }

    const reasonRaw = body.reason ?? body.type;
    const textRaw = typeof body.text === 'string' ? body.text.trim() : '';
    const guideUrlRaw = typeof body.guide_url === 'string' ? body.guide_url.trim() : '';
    const emailRaw =
      typeof body.reporter_email === 'string' && body.reporter_email.trim().length > 0
        ? body.reporter_email.trim()
        : null;

    if (!guideUrlRaw) {
      throw new ApiError(422, 'validation_failed', 'guide_url is required');
    }
    if (!textRaw || textRaw.length < 10) {
      throw new ApiError(422, 'validation_failed', 'text must be at least 10 characters');
    }
    if (textRaw.length > 1000) {
      throw new ApiError(422, 'validation_failed', 'text must be at most 1000 characters');
    }

    // Optional email validation
    if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      throw new ApiError(422, 'validation_failed', 'reporter_email must be a valid email address');
    }

    const reportType = normalizeReportType(reasonRaw);
    const parsed = parseGuideAddress(guideUrlRaw);

    const prisma = getPrisma();
    let orgId: string | null = null;
    let flowId: string | null = null;
    let tenantSlug: string | null = null;
    let tenantName: string | null = null;
    let guideSlug = parsed.guideSlug;

    if (parsed.hostOrTenant) {
      const hostOrTenantLower = parsed.hostOrTenant.toLowerCase();
      // Try finding organization by slug
      let org = await prisma.organization.findUnique({
        where: { slug: hostOrTenantLower },
      });

      // Try finding by custom domain
      if (!org && hostOrTenantLower.includes('.')) {
        const site = await prisma.workspaceSite.findFirst({
          where: { customDomain: hostOrTenantLower },
          include: { organization: true },
        });
        if (site?.organization) {
          org = site.organization;
        } else {
          // Subdomain match: foo.opendocs.xxx -> foo
          const sub = hostOrTenantLower.split('.')[0];
          if (sub) {
            org = await prisma.organization.findUnique({
              where: { slug: sub },
            });
          }
        }
      }

      if (org) {
        orgId = org.id;
        tenantSlug = org.slug;
        tenantName = org.name;

        if (guideSlug) {
          const flow = await prisma.flow.findFirst({
            where: {
              organizationId: org.id,
              deletedAt: null,
              OR: [{ slug: guideSlug }, { publicId: guideSlug }],
            },
          });
          if (flow) {
            flowId = flow.id;
            guideSlug = flow.slug ?? guideSlug;
          }
        }
      }
    }

    const report = await prisma.report.create({
      data: {
        type: reportType,
        status: 'new',
        text: textRaw,
        reporterEmail: emailRaw,
        guideAddress: parsed.guideAddress || guideUrlRaw,
        guideSlug,
        organizationId: orgId,
        flowId,
        tenantSlug,
        tenantName: tenantName ?? parsed.hostOrTenant ?? 'Unknown tenant',
      },
    });

    return {
      ok: true,
      id: report.id,
      status: report.status,
    };
  })
  // Staff platform reports listing
  .get('/api/v1/platform/reports', async ({ request, query }) => {
    await requirePlatformStaff(request);
    const prisma = getPrisma();

    const statusFilter = typeof query.status === 'string' ? query.status.trim().toLowerCase() : '';
    const where: Prisma.ReportWhereInput = {};

    if (statusFilter && statusFilter !== 'all') {
      if ((VALID_STATUSES as readonly string[]).includes(statusFilter)) {
        where.status = statusFilter;
      }
    }

    const [reports, countNew, countInReview, countActioned, countDismissed, totalCount] =
      await Promise.all([
        prisma.report.findMany({
          where,
          include: {
            organization: {
              select: { id: true, name: true, slug: true, suspendedAt: true },
            },
            flow: {
              select: { id: true, title: true, slug: true, visibility: true, deletedAt: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
        prisma.report.count({ where: { status: 'new' } }),
        prisma.report.count({ where: { status: 'in_review' } }),
        prisma.report.count({ where: { status: 'actioned' } }),
        prisma.report.count({ where: { status: 'dismissed' } }),
        prisma.report.count(),
      ]);

    const formattedReports = reports.map((r) => {
      const isEmailRevealed = Boolean(r.reporterEmailRevealedAt);
      return {
        id: r.id,
        type: r.type,
        status: r.status,
        text: r.text,
        guide_address: r.guideAddress,
        guide_slug: r.guideSlug ?? r.flow?.slug ?? null,
        tenant_name: r.organization?.name ?? r.tenantName ?? 'Unknown tenant',
        tenant_slug: r.organization?.slug ?? r.tenantSlug ?? null,
        organization_id: r.organizationId,
        flow_id: r.flowId,
        notes: r.notes,
        reporter_email: isEmailRevealed ? r.reporterEmail : null,
        reporter_email_masked: maskEmail(r.reporterEmail),
        reporter_email_revealed: isEmailRevealed,
        reporter_email_revealed_at: r.reporterEmailRevealedAt?.toISOString() ?? null,
        guide_visibility: r.flow ? (r.flow.deletedAt ? 'deleted' : r.flow.visibility) : null,
        guide_title: r.flow?.title ?? null,
        tenant_status: r.organization
          ? r.organization.suspendedAt
            ? 'suspended'
            : 'active'
          : 'unknown',
        created_at: r.createdAt.toISOString(),
        updated_at: r.updatedAt.toISOString(),
      };
    });

    return {
      reports: formattedReports,
      counts: {
        new: countNew,
        in_review: countInReview,
        actioned: countActioned,
        dismissed: countDismissed,
        total: totalCount,
      },
    };
  })
  // Staff report detail
  .get('/api/v1/platform/reports/:id', async ({ request, params }) => {
    await requirePlatformStaff(request);
    const prisma = getPrisma();

    const report = await prisma.report.findUnique({
      where: { id: params.id },
      include: {
        organization: {
          select: { id: true, name: true, slug: true, suspendedAt: true },
        },
        flow: {
          select: { id: true, title: true, slug: true, visibility: true, deletedAt: true },
        },
      },
    });

    if (!report) {
      throw new ApiError(404, 'not_found', 'Report not found');
    }

    const isEmailRevealed = Boolean(report.reporterEmailRevealedAt);

    return {
      report: {
        id: report.id,
        type: report.type,
        status: report.status,
        text: report.text,
        guide_address: report.guideAddress,
        guide_slug: report.guideSlug ?? report.flow?.slug ?? null,
        tenant_name: report.organization?.name ?? report.tenantName ?? 'Unknown tenant',
        tenant_slug: report.organization?.slug ?? report.tenantSlug ?? null,
        organization_id: report.organizationId,
        flow_id: report.flowId,
        notes: report.notes,
        reporter_email: isEmailRevealed ? report.reporterEmail : null,
        reporter_email_masked: maskEmail(report.reporterEmail),
        reporter_email_revealed: isEmailRevealed,
        reporter_email_revealed_at: report.reporterEmailRevealedAt?.toISOString() ?? null,
        guide_visibility: report.flow
          ? report.flow.deletedAt
            ? 'deleted'
            : report.flow.visibility
          : null,
        guide_title: report.flow?.title ?? null,
        tenant_status: report.organization
          ? report.organization.suspendedAt
            ? 'suspended'
            : 'active'
          : 'unknown',
        created_at: report.createdAt.toISOString(),
        updated_at: report.updatedAt.toISOString(),
      },
    };
  })
  // Staff update status
  .patch('/api/v1/platform/reports/:id/status', async ({ request, params }) => {
    const staff = await requirePlatformStaff(request);
    const body = await readJson(request);
    const rawStatus = typeof body.status === 'string' ? body.status.trim().toLowerCase() : '';

    if (!(VALID_STATUSES as readonly string[]).includes(rawStatus)) {
      throw new ApiError(
        422,
        'validation_failed',
        `status must be one of: ${VALID_STATUSES.join(', ')}`,
      );
    }

    const prisma = getPrisma();
    const existing = await prisma.report.findUnique({
      where: { id: params.id },
    });
    if (!existing) {
      throw new ApiError(404, 'not_found', 'Report not found');
    }

    const updated = await prisma.report.update({
      where: { id: params.id },
      data: { status: rawStatus },
    });

    await recordAuditLog({
      actorKind: 'staff',
      actorId: staff.userId,
      organizationId: existing.organizationId,
      action: `Staff changed report status from ${existing.status} to ${rawStatus}`,
      detail: {
        actorName: staff.name,
        actorEmail: staff.email,
        reportId: existing.id,
        previousStatus: existing.status,
        newStatus: rawStatus,
      },
    });

    return { ok: true, status: updated.status };
  })
  // Staff save note
  .post('/api/v1/platform/reports/:id/notes', async ({ request, params }) => {
    const staff = await requirePlatformStaff(request);
    const body = await readJson(request);
    const note = typeof body.notes === 'string' ? body.notes : typeof body.note === 'string' ? body.note : '';

    const prisma = getPrisma();
    const existing = await prisma.report.findUnique({
      where: { id: params.id },
    });
    if (!existing) {
      throw new ApiError(404, 'not_found', 'Report not found');
    }

    const updated = await prisma.report.update({
      where: { id: params.id },
      data: { notes: note },
    });

    await recordAuditLog({
      actorKind: 'staff',
      actorId: staff.userId,
      organizationId: existing.organizationId,
      action: 'Staff updated report note',
      detail: {
        actorName: staff.name,
        actorEmail: staff.email,
        reportId: existing.id,
        notes: note,
      },
    });

    return { ok: true, notes: updated.notes };
  })
  // Staff reveal email (logged)
  .post('/api/v1/platform/reports/:id/reveal-email', async ({ request, params }) => {
    const staff = await requirePlatformStaff(request);
    const prisma = getPrisma();

    const existing = await prisma.report.findUnique({
      where: { id: params.id },
    });
    if (!existing) {
      throw new ApiError(404, 'not_found', 'Report not found');
    }

    const updated = await prisma.report.update({
      where: { id: params.id },
      data: {
        reporterEmailRevealedAt: new Date(),
        revealedByStaffId: staff.userId,
      },
    });

    await recordAuditLog({
      actorKind: 'staff',
      actorId: staff.userId,
      organizationId: existing.organizationId,
      action: 'Staff revealed reporter email for abuse report',
      detail: {
        actorName: staff.name,
        actorEmail: staff.email,
        reportId: existing.id,
      },
    });

    return {
      ok: true,
      reporter_email: updated.reporterEmail,
      reporter_email_revealed: true,
    };
  })
  // Action: Unpublish guide (admin only!)
  .post('/api/v1/platform/reports/:id/actions/unpublish', async ({ request, params }) => {
    const admin = await requirePlatformAdmin(request);
    const body = await readJson(request);
    const reason = typeof body.reason === 'string' ? body.reason.trim() : 'Abuse report actioned';

    const prisma = getPrisma();
    const report = await prisma.report.findUnique({
      where: { id: params.id },
      include: { flow: true, organization: true },
    });
    if (!report) {
      throw new ApiError(404, 'not_found', 'Report not found');
    }

    let targetFlowId = report.flowId;
    if (!targetFlowId && report.organizationId && report.guideSlug) {
      const flow = await prisma.flow.findFirst({
        where: {
          organizationId: report.organizationId,
          deletedAt: null,
          OR: [{ slug: report.guideSlug }, { publicId: report.guideSlug }],
        },
      });
      if (flow) targetFlowId = flow.id;
    }

    if (targetFlowId) {
      await prisma.flow.update({
        where: { id: targetFlowId },
        data: { visibility: 'draft' },
      });
    }

    const updatedReport = await prisma.report.update({
      where: { id: params.id },
      data: { status: 'actioned' },
    });

    await recordAuditLog({
      actorKind: 'staff',
      actorId: admin.userId,
      organizationId: report.organizationId,
      action: 'Staff unpublished guide from abuse report',
      detail: {
        actorName: admin.name,
        actorEmail: admin.email,
        reportId: report.id,
        flowId: targetFlowId,
        guideSlug: report.guideSlug,
        reason,
      },
    });

    return {
      ok: true,
      guide_status: 'draft',
      status: updatedReport.status,
    };
  })
  // Action: Suspend tenant (admin only!)
  .post('/api/v1/platform/reports/:id/actions/suspend', async ({ request, params }) => {
    const admin = await requirePlatformAdmin(request);
    const body = await readJson(request);
    const reason = typeof body.reason === 'string' ? body.reason.trim() : 'Abuse report actioned';

    const prisma = getPrisma();
    const report = await prisma.report.findUnique({
      where: { id: params.id },
      include: { organization: true },
    });
    if (!report) {
      throw new ApiError(404, 'not_found', 'Report not found');
    }

    let targetOrgId = report.organizationId;
    if (!targetOrgId && report.tenantSlug) {
      const org = await prisma.organization.findUnique({
        where: { slug: report.tenantSlug },
      });
      if (org) targetOrgId = org.id;
    }

    if (targetOrgId) {
      await prisma.organization.update({
        where: { id: targetOrgId },
        data: { suspendedAt: new Date() },
      });
    }

    const updatedReport = await prisma.report.update({
      where: { id: params.id },
      data: { status: 'actioned' },
    });

    await recordAuditLog({
      actorKind: 'staff',
      actorId: admin.userId,
      organizationId: targetOrgId,
      action: 'Staff suspended tenant from abuse report',
      detail: {
        actorName: admin.name,
        actorEmail: admin.email,
        reportId: report.id,
        tenantSlug: report.tenantSlug,
        reason,
      },
    });

    return {
      ok: true,
      tenant_status: 'suspended',
      status: updatedReport.status,
    };
  })
  // Action: Dismiss report (staff)
  .post('/api/v1/platform/reports/:id/actions/dismiss', async ({ request, params }) => {
    const staff = await requirePlatformStaff(request);
    const body = await readJson(request);
    const reason = typeof body.reason === 'string' ? body.reason.trim() : 'Report dismissed';

    const prisma = getPrisma();
    const report = await prisma.report.findUnique({
      where: { id: params.id },
    });
    if (!report) {
      throw new ApiError(404, 'not_found', 'Report not found');
    }

    const updatedReport = await prisma.report.update({
      where: { id: params.id },
      data: { status: 'dismissed' },
    });

    await recordAuditLog({
      actorKind: 'staff',
      actorId: staff.userId,
      organizationId: report.organizationId,
      action: 'Staff dismissed report',
      detail: {
        actorName: staff.name,
        actorEmail: staff.email,
        reportId: report.id,
        reason,
      },
    });

    return {
      ok: true,
      status: updatedReport.status,
    };
  });
