import { expect } from 'bun:test';
import { getPrisma } from '../src/db';
import type { createApp } from '../src/index';

export const BASE_URL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3100';

const prisma = getPrisma();
export const realFetch = globalThis.fetch;

export type App = ReturnType<typeof createApp>;

export type GitHubAccount = {
  id: number;
  login: string;
  name: string;
  avatar_url: string;
  /** `null` models an account that hides its email. */
  email: string | null;
};

export const GITHUB_ACCOUNT: GitHubAccount = {
  id: 4242,
  login: 'octocat',
  name: 'Octo Cat',
  avatar_url: 'https://avatars.example/u/4242',
  email: 'octocat@example.com',
};

/** A second distinct account, for the non-owner member cases. */
export const OTHER_GITHUB_ACCOUNT: GitHubAccount = {
  id: 7373,
  login: 'hubot',
  name: 'Hu Bot',
  avatar_url: 'https://avatars.example/u/7373',
  email: 'hubot@example.com',
};

/** Built at runtime so no token-shaped literal is ever committed. */
export const fakeAccessToken = () => ['gho', crypto.randomUUID().replace(/-/g, '')].join('_');

/** Built at runtime for the same reason; shaped like a key the plugin would reject. */
export const fakeApiKey = () => ['od', crypto.randomUUID().replace(/-/g, '')].join('_');

export const cleanDatabase = async () => {
  await prisma.billingEvent.deleteMany();
  await prisma.aiGap.deleteMany();
  await prisma.aiMessage.deleteMany();
  await prisma.aiConversation.deleteMany();
  await prisma.aiCreditLedger.deleteMany();
  await prisma.aiAssistant.deleteMany();
  await prisma.report.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.analyticsDaily.deleteMany();
  await prisma.searchLog.deleteMany();
  await prisma.storageConnection.deleteMany();
  await prisma.step.deleteMany();
  await prisma.run.deleteMany();
  await prisma.flow.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.workspaceBilling.deleteMany();
  await prisma.workspaceSite.deleteMany();
  await prisma.usageDaily.deleteMany();
  await prisma.apikey.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.member.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.verification.deleteMany();
  await prisma.user.deleteMany();
};

/** Answers GitHub's OAuth endpoints; anything else falls through to the real fetch. */
export const stubGitHub = (account: Partial<GitHubAccount> = {}) => {
  const profile = { ...GITHUB_ACCOUNT, ...account };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    if (url.startsWith('https://github.com/login/oauth/access_token')) {
      return json({
        access_token: fakeAccessToken(),
        token_type: 'bearer',
        scope: 'read:user user:email',
      });
    }
    if (url.startsWith('https://api.github.com/user/emails')) {
      return json(
        profile.email
          ? [{ email: profile.email, primary: true, verified: true, visibility: 'public' }]
          : [],
      );
    }
    if (url.startsWith('https://api.github.com/user')) {
      return json(profile);
    }

    return realFetch(input as Parameters<typeof realFetch>[0], init);
  }) as typeof fetch;
};

export type Handoff = { state: string; cookie: string };

/** Starts the social sign-in flow and returns the OAuth state plus the cookies to replay. */
export const startSignIn = async (app: App): Promise<Handoff> => {
  const response = await app.handle(
    new Request(`${BASE_URL}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'github', callbackURL: `${BASE_URL}/welcome` }),
    }),
  );

  expect(response.status).toBe(200);
  const body = (await response.json()) as { url?: string };
  expect(body.url).toContain('github.com/login/oauth/authorize');

  const state = new URL(body.url!).searchParams.get('state');
  expect(state).toBeTruthy();

  const cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ');

  return { state: state!, cookie };
};

export const callback = (app: App, query: string, cookie: string) =>
  app.handle(
    new Request(`${BASE_URL}/api/auth/callback/github?${query}`, {
      headers: { cookie },
    }),
  );

/** Runs the whole fake GitHub flow and returns the signed-in session cookie. */
export const signIn = async (app: App, account: Partial<GitHubAccount> = {}): Promise<string> => {
  stubGitHub(account);

  const { state, cookie } = await startSignIn(app);
  const response = await callback(app, `code=${crypto.randomUUID()}&state=${state}`, cookie);

  const session = response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .filter((entry) => entry.includes('session_token='))
    .join('; ');

  expect(session).toContain('session_token=');
  return session;
};
