import { apiKey } from '@better-auth/api-key';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { organization } from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements, memberAc, ownerAc } from 'better-auth/plugins/organization/access';
import { getPrisma } from './db';
import { getEnv } from './env';
import { getInstanceOrg, joinInstanceOrg, syncMemberRole } from './instance-org';
import { isSignupOpen, SIGNUP_CLOSED_MESSAGE } from './signup-policy';

// C18 roles: owner, admin and editor. Better-Auth's api-key plugin checks `apiKey` permissions
// on the organization role itself, so owners and admins get them and editors do not.
const accessControl = createAccessControl({ ...defaultStatements, apiKey: ['create', 'read', 'update', 'delete'] });
const apiKeyActions = ['create', 'read', 'update', 'delete'] as const;
const organizationRoles = {
  owner: accessControl.newRole({ ...ownerAc.statements, apiKey: [...apiKeyActions] }),
  admin: accessControl.newRole({ ...adminAc.statements, apiKey: [...apiKeyActions] }),
  editor: accessControl.newRole({ ...memberAc.statements }),
};

/**
 * Better-Auth's organization endpoints stay mounted (the api-key plugin reads the
 * organization roles), but the instance has exactly one workspace and no invites: only
 * read endpoints are reachable. Create, switch, invite and member management are refused.
 */
const READABLE_ORGANIZATION_PATHS = new Set([
  '/organization/list',
  '/organization/get-active-member',
  '/organization/get-active-member-role',
  '/organization/has-permission',
]);

// Map of GitHub accountId (numeric string) -> login handle captured during OAuth profile mapping.
const pendingGitHubLogins = new Map<string, string>();

const env = getEnv();

export const auth = betterAuth({
  basePath: '/api/auth',
  baseURL: env.publicUrl,
  secret: env.authSecret,
  database: prismaAdapter(getPrisma(), { provider: 'postgresql' }),
  // The organization plugin expects an Invitation table; this instance has no invites
  // (C23 AC-07) and the invite endpoints are refused above, so the table is not created.
  advanced: { database: { validateSchema: false } },
  emailAndPassword: { enabled: false },
  // Without GitHub credentials there is no OAuth sign-in (the boot log warns about it).
  socialProviders: env.github
    ? {
        github: {
          clientId: env.github.clientId,
          clientSecret: env.github.clientSecret,
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
      }
    : {},
  plugins: [
    organization({ ac: accessControl, roles: organizationRoles, allowUserToCreateOrganization: false }),
    apiKey({
      // Keys belong to an organization, so `referenceId` is an Organization id.
      references: 'organization',
      apiKeyHeaders: 'x-api-key',
      // The plugin defaults to 10 requests/day per key; the api enforces its own limits.
      rateLimit: { enabled: false },
    }),
  ],
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path.startsWith('/organization/') && !READABLE_ORGANIZATION_PATHS.has(ctx.path)) {
        throw new APIError('NOT_FOUND', { code: 'not_found', message: 'Not found' });
      }

      if (ctx.path !== '/api-key/create') return;

      if ((ctx.body as { termsAccepted?: unknown } | undefined)?.termsAccepted !== true) {
        throw new APIError('UNPROCESSABLE_ENTITY', {
          code: 'validation_failed',
          message: 'Accept the terms to create a key',
        });
      }

      // The plugin does not know this field, so drop it before its own body validation.
      const { termsAccepted: _termsAccepted, ...rest } = ctx.body as Record<string, unknown>;
      ctx.body = rest;
    }),
    after: createAuthMiddleware(async (ctx) => {
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
        // A closed instance refuses strangers before the user row exists (AC-07); the
        // OAuth callback turns this into a redirect back to /sign-in carrying the message.
        before: async (user) => {
          if (!(await isSignupOpen(user.email))) {
            throw new APIError('FORBIDDEN', { code: 'signup_closed', message: SIGNUP_CLOSED_MESSAGE });
          }
          return { data: user };
        },
        // Every user is a member of the one instance workspace; the first becomes owner.
        after: async (user) => {
          await joinInstanceOrg(user);
        },
      },
    },
    session: {
      create: {
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

          const user = await getPrisma().user.findUnique({
            where: { id: session.userId },
            select: { id: true, email: true },
          });
          if (user) await syncMemberRole(user);

          // A fresh session starts in the instance workspace.
          const org = await getInstanceOrg();
          return { data: { ...session, activeOrganizationId: org.id } };
        },
      },
    },
  },
});
