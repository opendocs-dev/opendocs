import { apiKey } from '@better-auth/api-key';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { organization } from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements, memberAc, ownerAc } from 'better-auth/plugins/organization/access';
import { getPrisma } from './db';

const requireEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not set`);
  return value;
};

// C18 roles: owner, admin and editor. Better-Auth's api-key plugin checks `apiKey` permissions
// on the organization role itself, so owners and admins get them and editors do not.
const accessControl = createAccessControl({ ...defaultStatements, apiKey: ['create', 'read', 'update', 'delete'] });
const apiKeyActions = ['create', 'read', 'update', 'delete'] as const;
const organizationRoles = {
  owner: accessControl.newRole({ ...ownerAc.statements, apiKey: [...apiKeyActions] }),
  admin: accessControl.newRole({ ...adminAc.statements, apiKey: [...apiKeyActions] }),
  editor: accessControl.newRole({ ...memberAc.statements }),
};

// Lowercase only: the slug CHECK constraint (organization_slug_format) rejects uppercase.
export const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const MAX_OWNED_WORKSPACES = 5;

/** 6 random lowercase-alphanumeric chars, so a slug stays unique even for duplicate display names. */
export const slugSuffix = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => SLUG_ALPHABET[byte % SLUG_ALPHABET.length]).join('');
};

// The slugSuffix adds "-" + 6 chars, and organization_slug_format caps the whole slug at
// 30, so the display-name part alone must leave room for that: 30 - 7 = 23.
export const SLUGIFY_MAX_LENGTH = 23;

export const slugify = (value: string): string => {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUGIFY_MAX_LENGTH)
    .replace(/-+$/, '');
  return slug || 'workspace';
};

/** Generates a unique, non-reserved workspace slug. */
export const generateUniqueWorkspaceSlug = async (displayName: string): Promise<string> => {
  const prisma = getPrisma();
  const base = slugify(displayName);
  for (let i = 0; i < 20; i++) {
    const slug = `${base}-${slugSuffix()}`;
    const reserved = await prisma.reservedName.findUnique({ where: { name: slug } });
    if (reserved) continue;
    const existingOrg = await prisma.organization.findUnique({ where: { slug } });
    if (existingOrg) continue;
    const existingHistory = await prisma.siteAddressHistory.findUnique({ where: { slug } });
    if (existingHistory) continue;
    return slug;
  }
  throw new APIError('INTERNAL_SERVER_ERROR', {
    code: 'slug_generation_failed',
    message: 'Could not generate a unique workspace address',
  });
};

/** Creates the personal organization for a brand new user, with that user as owner. */
export const createPersonalOrganization = async (user: { id: string; name?: string | null; email: string }) => {
  const prisma = getPrisma();

  const alreadyHasOrg = await prisma.member.findFirst({ where: { userId: user.id } });
  if (alreadyHasOrg) return;

  const displayName = user.name?.trim() || user.email.split('@')[0] || 'Workspace';
  const now = new Date();

  // One nested write, so a failure never leaves an org without its owner.
  await prisma.organization.create({
    data: {
      id: crypto.randomUUID(),
      name: displayName,
      slug: `${slugify(displayName)}-${slugSuffix()}`,
      createdAt: now,
      members: { create: { id: crypto.randomUUID(), userId: user.id, role: 'owner', createdAt: now } },
    },
  });
};

// Map of GitHub accountId (numeric string) -> login handle captured during OAuth profile mapping.
const pendingGitHubLogins = new Map<string, string>();

export const auth = betterAuth({
  basePath: '/api/auth',
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(getPrisma(), { provider: 'postgresql' }),
  emailAndPassword: { enabled: false },
  socialProviders: {
    github: {
      clientId: requireEnv('GITHUB_CLIENT_ID'),
      clientSecret: requireEnv('GITHUB_CLIENT_SECRET'),
      // GitHub may hide the email; fall back to the stable noreply address.
      mapProfileToUser: (profile) => {
        if (profile.id != null && profile.login) {
          pendingGitHubLogins.set(String(profile.id), profile.login);
        }
        return {
          name: profile.name ?? profile.login,
          email: profile.email ?? `${profile.id}+${profile.login}@users.noreply.github.com`,
        };
      },
    },
  },
  plugins: [
    organization({ ac: accessControl, roles: organizationRoles }),
    apiKey({
      // Keys belong to an organization, so `referenceId` is an Organization id.
      references: 'organization',
      apiKeyHeaders: 'x-api-key',
      // ponytail: the plugin defaults to 10 requests/day per key. Daily quotas are
      // enforced by the API itself (DAILY_QUOTAS) in a later contract, so keep this off.
      rateLimit: { enabled: false },
    }),
  ],
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/organization/create') {
        const session = await auth.api.getSession({ headers: ctx.headers ?? new Headers() });
        if (!session) {
          throw new APIError('UNAUTHORIZED', {
            code: 'unauthorized',
            message: 'A valid session is required',
          });
        }

        const ownedCount = await getPrisma().member.count({
          where: { userId: session.user.id, role: 'owner' },
        });
        if (ownedCount >= MAX_OWNED_WORKSPACES) {
          throw new APIError('UNPROCESSABLE_ENTITY', {
            code: 'workspace_limit',
            message: `Workspace limit reached. You can own at most ${MAX_OWNED_WORKSPACES} workspaces.`,
          });
        }

        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) {
          throw new APIError('UNPROCESSABLE_ENTITY', {
            code: 'validation_failed',
            message: 'Workspace name is required',
          });
        }

        if (!body.slug || typeof body.slug !== 'string' || (body.slug as string).trim() === '') {
          body.slug = await generateUniqueWorkspaceSlug(name);
        } else {
          const rawSlug = (body.slug as string).trim().toLowerCase();
          const reserved = await getPrisma().reservedName.findUnique({ where: { name: rawSlug } });
          if (reserved) {
            throw new APIError('UNPROCESSABLE_ENTITY', {
              code: 'reserved_slug',
              message: reserved.reason || 'This address is reserved',
            });
          }
          const existingOrg = await getPrisma().organization.findUnique({ where: { slug: rawSlug } });
          if (existingOrg) {
            throw new APIError('UNPROCESSABLE_ENTITY', {
              code: 'slug_taken',
              message: 'Address is already taken',
            });
          }
          const existingHistory = await getPrisma().siteAddressHistory.findUnique({ where: { slug: rawSlug } });
          if (existingHistory) {
            throw new APIError('UNPROCESSABLE_ENTITY', {
              code: 'slug_taken',
              message: 'Address is already taken',
            });
          }
          body.slug = rawSlug;
        }
        ctx.body = body;
        return;
      }

      if (ctx.path !== '/api-key/create') return;

      if ((ctx.body as { termsAccepted?: unknown } | undefined)?.termsAccepted !== true) {
        throw new APIError('UNPROCESSABLE_ENTITY', {
          code: 'validation_failed',
          message: 'Accept the staging terms to create a key',
        });
      }

      // The plugin does not know this field, so drop it before its own body validation.
      const { termsAccepted: _termsAccepted, ...rest } = ctx.body as Record<string, unknown>;
      ctx.body = rest;
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/organization/create') {
        const returned = ctx.context.returned;
        if (!returned || returned instanceof Error || returned instanceof Response) return;

        const orgId = (returned as { id?: unknown }).id;
        if (typeof orgId !== 'string') return;

        await getPrisma().workspaceBilling.upsert({
          where: { organizationId: orgId },
          create: { organizationId: orgId, plan: 'free' },
          update: {},
        });

        const session = await auth.api.getSession({ headers: ctx.headers ?? new Headers() });
        if (session?.session.id) {
          await getPrisma().session.update({
            where: { id: session.session.id },
            data: { activeOrganizationId: orgId },
          });
        }
        return;
      }

      if (ctx.path !== '/api-key/create') return;

      const returned = ctx.context.returned;
      if (!returned || returned instanceof Error || returned instanceof Response) return;

      const keyId = (returned as { id?: unknown }).id;
      if (typeof keyId !== 'string') return;

      await getPrisma().apikey.update({
        where: { id: keyId },
        data: { termsAcceptedAt: new Date() },
      });
    }),
  },
  databaseHooks: {
    account: {
      create: {
        after: async (account) => {
          // The handle is cosmetic: sign-in must never fail because of it.
          try {
            if (account.providerId === 'github') {
              const login = pendingGitHubLogins.get(account.accountId);
              if (login) {
                await getPrisma().account.update({
                  where: { id: account.id },
                  data: { username: login },
                });
              }
            }
          } catch (error) {
            console.error('github handle not saved', error);
          } finally {
            pendingGitHubLogins.delete(account.accountId);
          }
        },
      },
    },
    user: {
      create: {
        after: async (user) => {
          await createPersonalOrganization(user);
        },
      },
    },
    session: {
      create: {
        // The personal org exists by now (user.create.after runs first), so a fresh
        // session can start in it instead of leaving the workspace unset.
        before: async (session) => {
          try {
            const githubAccount = await getPrisma().account.findFirst({
              where: { userId: session.userId, providerId: 'github' },
            });
            if (githubAccount) {
              const login = pendingGitHubLogins.get(githubAccount.accountId);
              if (login && githubAccount.username !== login) {
                await getPrisma().account.update({
                  where: { id: githubAccount.id },
                  data: { username: login },
                });
                pendingGitHubLogins.delete(githubAccount.accountId);
              }
            }
          } catch {
            // Background hook safety
          }

          const member = await getPrisma().member.findFirst({
            where: { userId: session.userId },
            orderBy: { createdAt: 'asc' },
          });

          return { data: { ...session, activeOrganizationId: member?.organizationId ?? null } };
        },
      },
    },
  },
});
