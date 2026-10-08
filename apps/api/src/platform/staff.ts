import { Elysia } from 'elysia';
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

export const platformStaffRoute = new Elysia()
  .get('/api/v1/platform/me', async ({ request }) => {
    const staff = await requirePlatformStaff(request);
    return {
      staff: {
        id: staff.userId,
        name: staff.name,
        email: staff.email,
        role: staff.role,
      },
    };
  })
  .get('/api/v1/platform/staff', async ({ request }) => {
    await requirePlatformStaff(request);
    const prisma = getPrisma();

    const staffUsers = await prisma.user.findMany({
      where: { staffRole: { not: null } },
      include: {
        sessions: {
          orderBy: { updatedAt: 'desc' },
          take: 1,
          select: { updatedAt: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return {
      staff: staffUsers.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: user.staffRole as 'admin' | 'support',
        two_factor_enabled: user.twoFactorEnabled,
        last_active_at: user.sessions[0]?.updatedAt?.toISOString() ?? user.updatedAt.toISOString(),
        created_at: user.createdAt.toISOString(),
      })),
    };
  })
  .post('/api/v1/platform/staff', async ({ request, status }) => {
    const admin = await requirePlatformAdmin(request);
    const body = await readJson(request);

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || !email.includes('@')) {
      throw new ApiError(422, 'validation_failed', 'A valid email is required');
    }

    const role = body.role;
    if (role !== 'admin' && role !== 'support') {
      throw new ApiError(422, 'validation_failed', 'Role must be either "admin" or "support"');
    }

    const prisma = getPrisma();
    const targetUser = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });

    if (!targetUser) {
      throw new ApiError(404, 'not_found', 'No user found with this email. The user must sign in once first.');
    }

    const updated = await prisma.user.update({
      where: { id: targetUser.id },
      data: { staffRole: role },
    });

    await recordAuditLog({
      actorKind: 'staff',
      actorId: admin.userId,
      action: `Added staff ${updated.email} with role ${role === 'admin' ? 'Admin' : 'Support'}`,
      detail: {
        targetUserId: updated.id,
        targetEmail: updated.email,
        role,
        actorName: admin.name,
        actorEmail: admin.email,
      },
    });

    return status(201, {
      staff: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        image: updated.image,
        role: updated.staffRole as 'admin' | 'support',
        two_factor_enabled: updated.twoFactorEnabled,
        last_active_at: updated.updatedAt.toISOString(),
        created_at: updated.createdAt.toISOString(),
      },
    });
  })
  .patch('/api/v1/platform/staff/:id', async ({ request, params }) => {
    const admin = await requirePlatformAdmin(request);
    const body = await readJson(request);

    const role = body.role;
    if (role !== 'admin' && role !== 'support') {
      throw new ApiError(422, 'validation_failed', 'Role must be either "admin" or "support"');
    }

    const prisma = getPrisma();
    const target = await prisma.user.findUnique({
      where: { id: params.id },
    });

    if (!target || !target.staffRole) {
      throw new ApiError(404, 'not_found', 'Staff member not found');
    }

    if (admin.userId === target.id && role !== 'admin') {
      const adminCount = await prisma.user.count({ where: { staffRole: 'admin' } });
      if (adminCount <= 1) {
        throw new ApiError(422, 'validation_failed', 'Cannot demote the only platform admin');
      }
    }

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { staffRole: role },
    });

    await recordAuditLog({
      actorKind: 'staff',
      actorId: admin.userId,
      action: `Changed role of ${updated.email} to ${role === 'admin' ? 'Admin' : 'Support'}`,
      detail: {
        targetUserId: updated.id,
        targetEmail: updated.email,
        role,
        actorName: admin.name,
        actorEmail: admin.email,
      },
    });

    return {
      staff: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        image: updated.image,
        role: updated.staffRole as 'admin' | 'support',
        two_factor_enabled: updated.twoFactorEnabled,
        last_active_at: updated.updatedAt.toISOString(),
        created_at: updated.createdAt.toISOString(),
      },
    };
  })
  .delete('/api/v1/platform/staff/:id', async ({ request, params }) => {
    const admin = await requirePlatformAdmin(request);
    const prisma = getPrisma();

    const target = await prisma.user.findUnique({
      where: { id: params.id },
    });

    if (!target || !target.staffRole) {
      throw new ApiError(404, 'not_found', 'Staff member not found');
    }

    if (admin.userId === target.id) {
      const adminCount = await prisma.user.count({ where: { staffRole: 'admin' } });
      if (adminCount <= 1) {
        throw new ApiError(422, 'validation_failed', 'Cannot remove the only platform admin');
      }
    }

    await prisma.user.update({
      where: { id: target.id },
      data: { staffRole: null },
    });

    await recordAuditLog({
      actorKind: 'staff',
      actorId: admin.userId,
      action: `Removed staff ${target.email}`,
      detail: {
        targetUserId: target.id,
        targetEmail: target.email,
        actorName: admin.name,
        actorEmail: admin.email,
      },
    });

    return { ok: true };
  });
