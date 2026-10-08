import { Elysia } from 'elysia';
import { auth } from '../auth';
import { getPrisma } from '../db';
import { ApiError } from '../errors';
import { roleFor } from '../site/role';

const requireSessionAndMember = async (request: Request) => {
  const session = await auth.api.getSession({ headers: request.headers });
  const organizationId = session?.session.activeOrganizationId;
  if (!session || !organizationId) {
    throw new ApiError(401, 'unauthorized', 'A valid session is required');
  }
  const role = await roleFor(session.user.id, organizationId);
  if (!role) {
    throw new ApiError(403, 'unauthorized', 'You are not a member of this workspace');
  }
  return { userId: session.user.id, organizationId, role };
};

const RECENT_KEY_USE_MS = 24 * 60 * 60 * 1000;

export const recordingStatusRoute = new Elysia().get(
  '/api/v1/recording-status',
  async ({ request, query }) => {
    const { organizationId } = await requireSessionAndMember(request);
    const prisma = getPrisma();

    const [keys, latestRun] = await Promise.all([
      prisma.apikey.findMany({
        where: { referenceId: organizationId, enabled: true },
        orderBy: [
          { lastRequest: 'desc' },
          { createdAt: 'desc' },
        ],
        select: {
          id: true,
          name: true,
          lastRequest: true,
          createdAt: true,
        },
      }),
      prisma.run.findFirst({
        where: {
          flow: {
            organizationId,
            deletedAt: null,
          },
        },
        orderBy: { startedAt: 'desc' },
        select: {
          id: true,
          publicId: true,
          status: true,
          startedAt: true,
          compiledAt: true,
          flow: {
            select: {
              id: true,
              publicId: true,
              title: true,
            },
          },
          _count: {
            select: {
              steps: true,
            },
          },
        },
      }),
    ]);

    const hasKey = keys.length > 0;
    const mostRecentKey = keys[0] ?? null;
    const now = Date.now();

    const keyUsedRecently = Boolean(
      mostRecentKey?.lastRequest &&
      now - mostRecentKey.lastRequest.getTime() < RECENT_KEY_USE_MS,
    );

    const runIsRecent = Boolean(
      latestRun && now - latestRun.startedAt.getTime() < RECENT_KEY_USE_MS,
    );
    const connected = keyUsedRecently || runIsRecent;

    let recordingStarted = false;
    let stepsCount = 0;
    let compileState: 'none' | 'running' | 'done' = 'none';
    let guideId: string | null = null;
    let sessionId: string | null = null;

    if (latestRun) {
      sessionId = latestRun.publicId;
      stepsCount = latestRun._count.steps;
      recordingStarted = true;

      if (latestRun.status === 'compiled') {
        compileState = 'done';
        guideId = latestRun.flow.publicId;
      } else if (latestRun.status === 'compiling' || latestRun.status === 'running') {
        compileState = 'running';
        guideId = latestRun.flow.publicId;
      } else {
        compileState = 'none';
      }

      const sinceParam = query?.since as string | undefined;
      if (sinceParam) {
        const sinceDate = new Date(sinceParam);
        if (!Number.isNaN(sinceDate.getTime())) {
          if (latestRun.startedAt < sinceDate && latestRun.status === 'compiled') {
            recordingStarted = false;
            stepsCount = 0;
            compileState = 'none';
            guideId = null;
            sessionId = null;
          }
        }
      }
    }

    return {
      connected,
      has_key: hasKey,
      key_name: mostRecentKey?.name ?? null,
      key_last_used: mostRecentKey?.lastRequest ? mostRecentKey.lastRequest.toISOString() : null,
      recording_started: recordingStarted,
      steps_count: stepsCount,
      compile_state: compileState,
      guide_id: guideId,
      session_id: sessionId,
    };
  },
);
