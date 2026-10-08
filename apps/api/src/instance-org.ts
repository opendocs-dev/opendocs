import type { Organization } from '../generated/prisma/client';
import { getPrisma } from './db';
import { getEnv } from './env';

/** Slug of the one workspace an instance has (C23 AC-06). */
export const INSTANCE_ORG_SLUG = 'main';

/** Fixed key for the advisory lock that serialises the "first member becomes owner" decision. */
const MEMBERSHIP_LOCK_ID = 842_331_010;

export type Role = 'owner' | 'admin' | 'editor';

/**
 * The instance's single workspace, created on first call (slug `main`, name `SITE_NAME`).
 * Safe against races: concurrent first calls collide on the unique slug and the loser
 * reads the winner's row.
 */
export const getInstanceOrg = async (): Promise<Organization> => {
  const prisma = getPrisma();
  const find = () => prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });

  const existing = await find();
  if (existing) return existing;

  try {
    return await prisma.organization.create({
      data: { id: crypto.randomUUID(), name: getEnv().siteName, slug: INSTANCE_ORG_SLUG, createdAt: new Date() },
    });
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    const winner = await find();
    if (!winner) throw error;
    return winner;
  }
};

export const isAdminEmail = (email: string): boolean => getEnv().adminEmails.includes(email.trim().toLowerCase());

/** Role for a non-first member: `ADMIN_EMAILS` (case-insensitive) is admin, everyone else editor. */
const roleByEmail = (email: string): Role => (isAdminEmail(email) ? 'admin' : 'editor');

/**
 * Makes `user` a member of the instance workspace. The first member ever is the owner and
 * must be listed in `ADMIN_EMAILS` (a stranger is refused, unless `allowAnyFirstOwner`, which
 * only the test-only E2E login uses); the check and the insert share an advisory lock so two
 * simultaneous first sign-ins cannot both become owner.
 */
export const joinInstanceOrg = async (
  user: { id: string; email: string },
  options: { allowAnyFirstOwner?: boolean } = {},
): Promise<Role> => {
  const org = await getInstanceOrg();
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MEMBERSHIP_LOCK_ID})`;

    const existing = await tx.member.findUnique({
      where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
    });
    if (existing) return existing.role as Role;

    const members = await tx.member.count({ where: { organizationId: org.id } });
    if (members === 0 && !options.allowAnyFirstOwner && !isAdminEmail(user.email)) {
      throw new Error('The first owner must be listed in ADMIN_EMAILS');
    }
    const role: Role = members === 0 ? 'owner' : roleByEmail(user.email);
    await tx.member.create({
      data: { id: crypto.randomUUID(), organizationId: org.id, userId: user.id, role, createdAt: new Date() },
    });
    return role;
  });
};

/**
 * Applies a later `ADMIN_EMAILS` change at the next sign-in: a non-owner is admin when
 * listed and editor otherwise. The owner is never touched.
 */
export const syncMemberRole = async (user: { id: string; email: string }): Promise<void> => {
  const org = await getInstanceOrg();
  const prisma = getPrisma();
  const member = await prisma.member.findUnique({
    where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
  });
  if (!member || member.role === 'owner') return;

  const desired = roleByEmail(user.email);
  if (member.role !== desired) {
    await prisma.member.update({ where: { id: member.id }, data: { role: desired } });
  }
};
