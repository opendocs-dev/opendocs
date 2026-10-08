import { Elysia } from 'elysia';
import { getPrisma } from '../db';
import { requirePlatformStaff } from '../platform-guard';

export const platformAuditLogRoute = new Elysia().get(
  '/api/v1/platform/audit-log',
  async ({ request, query }) => {
    await requirePlatformStaff(request);
    const prisma = getPrisma();

    const limit = Math.min(Math.max(Number(query.limit ?? 100), 1), 500);

    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        organization: {
          select: { id: true, name: true, slug: true },
        },
      },
    });

    const actorUserIds = Array.from(
      new Set(logs.filter((l) => l.actorKind === 'staff' || l.actorKind === 'user').map((l) => l.actorId)),
    );

    const users = await prisma.user.findMany({
      where: { id: { in: actorUserIds } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return {
      audit_logs: logs.map((log) => {
        const actor = userMap.get(log.actorId);
        const detailObj = typeof log.detail === 'object' && log.detail !== null ? (log.detail as Record<string, unknown>) : {};
        return {
          id: log.id,
          created_at: log.createdAt.toISOString(),
          actor_kind: log.actorKind,
          actor_id: log.actorId,
          actor_name: actor?.name ?? (detailObj.actorName as string) ?? (log.actorKind === 'apikey' ? 'API key' : 'Staff'),
          actor_email: actor?.email ?? (detailObj.actorEmail as string) ?? null,
          action: log.action,
          tenant_name: log.organization?.name ?? '–',
          organization_id: log.organizationId,
          detail: log.detail,
        };
      }),
    };
  },
);
