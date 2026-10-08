import { Elysia } from 'elysia';
import { getPrisma } from '../db';
import { ApiError } from '../errors';
import { requireSession } from '../site/session';

const invalid = (message: string) => new ApiError(422, 'validation_failed', message);

const readJsonBody = async (request: Request): Promise<Record<string, unknown>> => {
  const text = await request.text().catch(() => {
    throw invalid('A JSON request body is required');
  });

  let parsed: unknown = {};
  if (text.trim().length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw invalid('Request body must be valid JSON');
    }
  }

  return (parsed as Record<string, unknown>) ?? {};
};

/**
 * Account settings for the signed-in person (C14-AC25, UI-A15): profile name is editable
 * (1-80 chars), photo and email come from GitHub and remain read-only.
 * The weekly-digest preference is synced with the legacy
 * `email_notifications` boolean.
 */
export const accountRoute = new Elysia()
  .get('/api/v1/account', async ({ request }) => {
    const { userId } = await requireSession(request);
    const prisma = getPrisma();

    const [user, account] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          name: true,
          email: true,
          image: true,
          emailNotifications: true,
          notifyWeeklyDigest: true,
        },
      }),
      prisma.account.findFirst({
        where: { userId, providerId: 'github' },
        select: { username: true },
      }),
    ]);

    return {
      name: user.name,
      email: user.email,
      image: user.image,
      email_notifications: user.emailNotifications,
      notify_weekly_digest: user.notifyWeeklyDigest,
      github_handle: account?.username ?? null,
    };
  })
  .patch('/api/v1/account', async ({ request }) => {
    const { userId } = await requireSession(request);
    const prisma = getPrisma();
    const body = await readJsonBody(request);

    const updateData: {
      name?: string;
      emailNotifications?: boolean;
      notifyWeeklyDigest?: boolean;
    } = {};

    let hasUpdate = false;

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length < 1 || body.name.trim().length > 80) {
        throw invalid('Name must be between 1 and 80 characters');
      }
      updateData.name = body.name.trim();
      hasUpdate = true;
    }

    if (body.email_notifications !== undefined) {
      if (typeof body.email_notifications !== 'boolean') {
        throw invalid('email_notifications must be a boolean');
      }
      const val = body.email_notifications;
      updateData.emailNotifications = val;
      updateData.notifyWeeklyDigest = val;
      hasUpdate = true;
    } else {
      let togglesChanged = false;
      for (const [key, field] of [
        ['notify_weekly_digest', 'notifyWeeklyDigest'],
      ] as const) {
        if (body[key] !== undefined) {
          if (typeof body[key] !== 'boolean') {
            throw invalid(`${key} must be a boolean`);
          }
          updateData[field] = body[key] as boolean;
          togglesChanged = true;
          hasUpdate = true;
        }
      }

      if (togglesChanged) {
        const current = await prisma.user.findUniqueOrThrow({
          where: { id: userId },
          select: {
            notifyWeeklyDigest: true,
          },
        });
        updateData.emailNotifications = updateData.notifyWeeklyDigest ?? current.notifyWeeklyDigest;
      }
    }

    if (!hasUpdate) {
      throw invalid('No valid fields provided to update');
    }

    const [user, account] = await Promise.all([
      prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: {
          name: true,
          email: true,
          image: true,
          emailNotifications: true,
          notifyWeeklyDigest: true,
        },
      }),
      prisma.account.findFirst({
        where: { userId, providerId: 'github' },
        select: { username: true },
      }),
    ]);

    return {
      name: user.name,
      email: user.email,
      image: user.image,
      email_notifications: user.emailNotifications,
      notify_weekly_digest: user.notifyWeeklyDigest,
      github_handle: account?.username ?? null,
    };
  });
