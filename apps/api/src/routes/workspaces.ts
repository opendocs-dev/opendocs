import { Elysia } from 'elysia';
import { auth, generateUniqueWorkspaceSlug, MAX_OWNED_WORKSPACES } from '../auth';
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

export const workspacesRoute = new Elysia()
  .get('/api/v1/workspaces', async ({ request }) => {
    const { userId, organizationId } = await requireSession(request);
    const prisma = getPrisma();

    const members = await prisma.member.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });

    return {
      workspaces: members.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role,
        is_active: m.organization.id === organizationId,
      })),
    };
  })
  .post('/api/v1/workspaces', async ({ request }) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      throw new ApiError(401, 'unauthorized', 'A valid session is required');
    }

    const prisma = getPrisma();
    const ownedCount = await prisma.member.count({
      where: { userId: session.user.id, role: 'owner' },
    });

    if (ownedCount >= MAX_OWNED_WORKSPACES) {
      throw new ApiError(
        422,
        'validation_failed',
        `Workspace limit reached. You can own at most ${MAX_OWNED_WORKSPACES} workspaces.`,
      );
    }

    const body = await readJsonBody(request);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      throw invalid('Workspace name is required');
    }

    const slug = await generateUniqueWorkspaceSlug(name);
    const now = new Date();

    const org = await prisma.organization.create({
      data: {
        id: crypto.randomUUID(),
        name,
        slug,
        createdAt: now,
        members: {
          create: {
            id: crypto.randomUUID(),
            userId: session.user.id,
            role: 'owner',
            createdAt: now,
          },
        },
        billing: {
          create: {
            plan: 'free',
          },
        },
      },
    });

    if (session.session.id) {
      await prisma.session.update({
        where: { id: session.session.id },
        data: { activeOrganizationId: org.id },
      });
    }

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
    };
  })
  .post('/api/v1/workspaces/switch', async ({ request }) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      throw new ApiError(401, 'unauthorized', 'A valid session is required');
    }

    const body = await readJsonBody(request);
    const organizationId = typeof body.organizationId === 'string' ? body.organizationId : '';
    if (!organizationId) {
      throw invalid('Organization id is required');
    }

    const prisma = getPrisma();
    const member = await prisma.member.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: session.user.id,
        },
      },
    });

    if (!member) {
      throw new ApiError(403, 'unauthorized', 'User is not a member of the organization');
    }

    if (session.session.id) {
      await prisma.session.update({
        where: { id: session.session.id },
        data: { activeOrganizationId: organizationId },
      });
    }

    return {
      success: true,
      activeOrganizationId: organizationId,
    };
  });
