import { Elysia } from 'elysia';
import { getPrisma } from '../db';
import { ApiError } from '../errors';
import { normalizeRole } from '../site/role';
import { requireMember, requireSession } from '../site/session';
import type { Prisma } from '../../generated/prisma/client';

/** How far back the activity log reaches. */
const RETENTION_DAYS = 365;

export const activityLogRoute = new Elysia()
  .get('/api/v1/activity-log', async ({ request, query }) => {
    const { userId, organizationId } = await requireSession(request);
    const caller = await requireMember(userId, organizationId);
    const callerRole = normalizeRole(caller.role);

    if (callerRole !== 'owner' && callerRole !== 'admin') {
      throw new ApiError(403, 'unauthorized', 'Only the owner or an admin can view the activity log');
    }

    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const where: Prisma.AuditLogWhereInput = {
      organizationId,
      createdAt: { gte: cutoff },
    };

    const person = typeof query.person === 'string' ? query.person.trim() : '';
    if (person === 'apikey') {
      where.actorKind = 'apikey';
    } else if (person && person !== 'all' && person !== 'everyone') {
      where.actorId = person;
    }

    const type = typeof query.type === 'string' ? query.type.trim().toLowerCase() : '';
    if (type && type !== 'all' && type !== 'all changes') {
      where.detail = {
        path: ['type'],
        equals: type,
      };
    }

    const prisma = getPrisma();

    // Pagination: limit defaults to 50, capped at 100
    const rawLimit = typeof query.limit === 'string' ? parseInt(query.limit, 10) : NaN;
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50;

    const cursor = typeof query.cursor === 'string' && query.cursor.trim() ? query.cursor.trim() : undefined;
    let cursorRow: { id: string; createdAt: Date } | null = null;
    if (cursor !== undefined) {
      cursorRow = await prisma.auditLog.findFirst({
        where: { id: cursor, organizationId },
        select: { id: true, createdAt: true },
      });
      if (!cursorRow) {
        throw new ApiError(400, 'validation_failed', 'cursor does not match a known activity log');
      }
    }

    const rawOffset = typeof query.offset === 'string' ? parseInt(query.offset, 10) : NaN;
    const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

    if (cursorRow) {
      where.OR = [
        { createdAt: { lt: cursorRow.createdAt } },
        { createdAt: cursorRow.createdAt, id: { lt: cursorRow.id } },
      ];
    }

    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(!cursorRow && offset > 0 ? { skip: offset } : {}),
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? pageRows[pageRows.length - 1]!.id : null;

    const userIds = Array.from(
      new Set(pageRows.filter((r) => r.actorKind === 'user').map((r) => r.actorId)),
    );

    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true, image: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return {
      activity_logs: pageRows.map((r) => {
        const u = userMap.get(r.actorId);
        const detailObj = typeof r.detail === 'object' && r.detail !== null ? (r.detail as Record<string, unknown>) : {};
        return {
          id: r.id,
          created_at: r.createdAt.toISOString(),
          actor_kind: r.actorKind,
          actor_id: r.actorId,
          actor_name: u?.name ?? (detailObj.actorName as string) ?? (r.actorKind === 'apikey' ? 'API key' : 'User'),
          actor_email: u?.email ?? (detailObj.actorEmail as string) ?? null,
          actor_image: u?.image ?? null,
          action: r.action,
          type: (detailObj.type as string) ?? 'general',
          detail: r.detail,
        };
      }),
      retention_days: RETENTION_DAYS,
      can_export: true,
      next_cursor: nextCursor,
      has_more: hasMore,
    };
  })
  .get('/api/v1/activity-log/export', async ({ request }) => {
    const { userId, organizationId } = await requireSession(request);
    const caller = await requireMember(userId, organizationId);
    const callerRole = normalizeRole(caller.role);

    if (callerRole !== 'owner' && callerRole !== 'admin') {
      throw new ApiError(403, 'unauthorized', 'Only the owner or an admin can export the activity log');
    }

    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const prisma = getPrisma();

    const rows = await prisma.auditLog.findMany({
      where: {
        organizationId,
        createdAt: { gte: cutoff },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5000,
    });

    const userIds = Array.from(
      new Set(rows.filter((r) => r.actorKind === 'user').map((r) => r.actorId)),
    );

    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const escapeCsv = (str: string) => `"${str.replace(/"/g, '""')}"`;

    const csvLines = [
      'When,Who,What',
      ...rows.map((r) => {
        const u = userMap.get(r.actorId);
        const detailObj = typeof r.detail === 'object' && r.detail !== null ? (r.detail as Record<string, unknown>) : {};
        const who = u?.name ?? (detailObj.actorName as string) ?? (r.actorKind === 'apikey' ? 'API key' : 'User');
        return `${escapeCsv(r.createdAt.toISOString())},${escapeCsv(who)},${escapeCsv(r.action)}`;
      }),
    ];

    return new Response(csvLines.join('\n'), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="activity-log.csv"',
      },
    });
  });
