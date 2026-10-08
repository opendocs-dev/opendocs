import { Elysia } from 'elysia';
import { getPrisma } from '../db';
import { requireMember, requireSession } from '../site/session';
import { normalizeRole } from '../site/role';
import { ApiError } from '../errors';

const forbidden = () => new ApiError(403, 'unauthorized', 'Only the owner or an admin can view members');

/**
 * Members of the instance workspace with their roles (C14-AC24; invites are gone, C23
 * AC-07). Owner and admin only, like the other workspace-settings routes (site, keys):
 * editors manage content, not who else is in the workspace.
 */
export const membersRoute = new Elysia().get('/api/v1/members', async ({ request }) => {
  const { userId, organizationId } = await requireSession(request);

  const caller = await requireMember(userId, organizationId);
  const callerRole = normalizeRole(caller.role);
  if (callerRole !== 'owner' && callerRole !== 'admin') throw forbidden();

  const prisma = getPrisma();

  const members = await prisma.member.findMany({
    where: { organizationId },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return {
    members: members.map((member) => ({
      id: member.id,
      user_id: member.userId,
      name: member.user.name,
      email: member.user.email,
      image: member.user.image,
      role: normalizeRole(member.role),
      member_since: member.createdAt.toISOString(),
      last_active_at: member.lastActiveAt ? member.lastActiveAt.toISOString() : null,
    })),
  };
});
