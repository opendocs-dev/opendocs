import { getPrisma } from '../db';

/**
 * Normalizes role strings: 'member' and any unknown value become 'editor'.
 */
export const normalizeRole = (raw: string): 'owner' | 'admin' | 'editor' => {
  if (raw === 'owner' || raw === 'admin') return raw;
  return 'editor';
};

/**
 * Looks up the role of a user in an organization.
 * Returns the normalized role, or null if the user is not a member.
 */
export const roleFor = async (userId: string, organizationId: string): Promise<'owner' | 'admin' | 'editor' | null> => {
  const member = await getPrisma().member.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { role: true },
  });
  if (!member) return null;
  return normalizeRole(member.role);
};
