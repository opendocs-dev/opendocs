import { auth } from './auth';
import { getPrisma } from './db';
import { ApiError } from './errors';
import type { User } from '../generated/prisma/client';

export type PlatformRole = 'admin' | 'support';

export type PlatformStaffInfo = {
  userId: string;
  email: string;
  name: string;
  role: PlatformRole;
  user: User;
};

/**
 * Migration helper reading legacy `PLATFORM_ADMIN_EMAILS` (comma-separated, case-insensitive).
 * Retained for backward-compatible fallback until the stopgap is completely decommissioned.
 */
export const platformAdminEmails = (): Set<string> => {
  const raw = process.env.PLATFORM_ADMIN_EMAILS ?? '';
  return new Set(
    raw
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  );
};

/** True when legacy fallback auto-promotion has been disabled via env. */
export const isPlatformAdminFallbackDisabled = (): boolean =>
  process.env.PLATFORM_ADMIN_FALLBACK_DISABLED === 'true';

/** True when `email` is on the legacy `PLATFORM_ADMIN_EMAILS` allow-list. */
export const isPlatformAdminEmail = (email: string): boolean =>
  platformAdminEmails().has(email.toLowerCase());

/**
 * Verifies whether all emails listed in `PLATFORM_ADMIN_EMAILS` have been migrated
 * to `staffRole: 'admin'`. When `verified` is true, the legacy env var can be safely retired.
 */
export const verifyPlatformAdminMigration = async (): Promise<{
  verified: boolean;
  pendingCount: number;
  pendingEmails: string[];
}> => {
  const emails = Array.from(platformAdminEmails());
  if (emails.length === 0) return { verified: true, pendingCount: 0, pendingEmails: [] };

  const prisma = getPrisma();
  const pendingUsers = await prisma.user.findMany({
    where: {
      email: { in: emails, mode: 'insensitive' },
      staffRole: null,
    },
    select: { email: true },
  });

  const pendingEmails = pendingUsers.map((u) => u.email);
  return {
    verified: pendingEmails.length === 0,
    pendingCount: pendingEmails.length,
    pendingEmails,
  };
};

/**
 * One-time or startup migration that assigns `staffRole = 'admin'` to any existing
 * users whose emails are listed in `PLATFORM_ADMIN_EMAILS`.
 */
export const migratePlatformAdminsFromEnv = async (): Promise<number> => {
  const emails = Array.from(platformAdminEmails());
  if (emails.length === 0) return 0;

  const prisma = getPrisma();
  const users = await prisma.user.findMany({
    where: {
      email: { in: emails, mode: 'insensitive' },
      staffRole: null,
    },
  });

  if (users.length === 0) return 0;

  await prisma.user.updateMany({
    where: { id: { in: users.map((u) => u.id) } },
    data: { staffRole: 'admin' },
  });

  return users.length;
};

/**
 * Resolves the platform staff identity of the signed-in user, auto-migrating legacy
 * admins from `PLATFORM_ADMIN_EMAILS` if their `staffRole` is not yet set.
 */
export const getPlatformStaffUser = async (request: Request): Promise<PlatformStaffInfo | null> => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;

  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  });
  if (!user) return null;

  // 1. Direct database staff role
  if (user.staffRole === 'admin' || user.staffRole === 'support') {
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.staffRole as PlatformRole,
      user,
    };
  }

  // 2. Seamless migration fallback from PLATFORM_ADMIN_EMAILS stopgap (active until cutover)
  if (!isPlatformAdminFallbackDisabled() && user.email && isPlatformAdminEmail(user.email)) {
    console.warn(
      `[DEPRECATION] User ${user.email} auto-promoted to staffRole='admin' from legacy PLATFORM_ADMIN_EMAILS. This fallback will be retired once all platform admins are verified.`,
    );
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { staffRole: 'admin' },
    });
    return {
      userId: updated.id,
      email: updated.email,
      name: updated.name,
      role: 'admin',
      user: updated,
    };
  }

  return null;
};

/**
 * Requires a signed-in user with staff role ('admin' or 'support').
 * Throws 401 with no session, 403 otherwise.
 */
export const requirePlatformStaff = async (request: Request): Promise<PlatformStaffInfo> => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new ApiError(401, 'unauthorized', 'A valid session is required');

  const staff = await getPlatformStaffUser(request);
  if (!staff) throw new ApiError(403, 'unauthorized', 'Platform staff access required');

  return staff;
};

/**
 * Requires a signed-in user with platform 'admin' role.
 * Throws 401 with no session, 403 otherwise (including for 'support' staff).
 */
export const requirePlatformAdmin = async (request: Request): Promise<PlatformStaffInfo> => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new ApiError(401, 'unauthorized', 'A valid session is required');

  const staff = await getPlatformStaffUser(request);
  if (!staff || staff.role !== 'admin') throw new ApiError(403, 'unauthorized', 'Platform admin access required');

  return staff;
};
