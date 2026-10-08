import { auth } from '../auth';
import { getPrisma } from '../db';
import { ApiError } from '../errors';

const unauthorized = () => new ApiError(401, 'unauthorized', 'A valid session is required');

const ONE_HOUR_MS = 60 * 60 * 1000;
const lastActiveCache = new Map<string, number>();

export const _resetLastActiveCacheForTest = () => {
  lastActiveCache.clear();
};

/**
 * UI-A14 finding 4: updates lastActiveAt on the member record at most once per hour
 * per member when they use the API (cheap, no write on every request).
 */
export const touchMemberLastActive = async (userId: string, organizationId: string) => {
  const key = `${organizationId}:${userId}`;
  const now = Date.now();
  const last = lastActiveCache.get(key) ?? 0;
  if (now - last < ONE_HOUR_MS) return;

  lastActiveCache.set(key, now);
  try {
    await getPrisma().member.updateMany({
      where: {
        organizationId,
        userId,
        OR: [
          { lastActiveAt: null },
          { lastActiveAt: { lt: new Date(now - ONE_HOUR_MS) } },
        ],
      },
      data: { lastActiveAt: new Date(now) },
    });
  } catch {
    // Ignore background touch failure
  }
};

/**
 * API keys are deliberately not accepted on the site routes (unlike the rest of the API):
 * the site address is a workspace-owner concern managed from the dashboard, not the CLI.
 */
export const requireSession = async (request: Request) => {
  const session = await auth.api.getSession({ headers: request.headers });
  const organizationId = session?.session.activeOrganizationId;
  if (!session || !organizationId) throw unauthorized();
  void touchMemberLastActive(session.user.id, organizationId);
  return { userId: session.user.id, organizationId };
};

/**
 * Loads the member record for a user in an organization and throws 403 if not found.
 */
export const requireMember = async (userId: string, organizationId: string) => {
  const member = await getPrisma().member.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
  if (!member) {
    throw new ApiError(403, 'unauthorized', 'You are not a member of this workspace');
  }
  return member;
};
