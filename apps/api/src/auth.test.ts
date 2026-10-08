import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import {
  BASE_URL,
  GITHUB_ACCOUNT,
  OTHER_GITHUB_ACCOUNT,
  callback,
  cleanDatabase,
  realFetch,
  signIn,
  startSignIn,
  stubGitHub,
  type App,
} from '../test/helpers';
import { auth } from './auth';
import { getPrisma } from './db';
import { createApp } from './index';

const prisma = getPrisma();

type CreateBody = { organizationId: string; name?: string; termsAccepted?: boolean };

const createKey = (app: App, cookie: string, body: CreateBody) =>
  app.handle(
    new Request(`${BASE_URL}/api/auth/api-key/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    }),
  );

const revokeKey = (app: App, cookie: string, keyId: string) =>
  app.handle(
    new Request(`${BASE_URL}/api/auth/api-key/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ keyId }),
    }),
  );

beforeEach(async () => {
  await cleanDatabase();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  await cleanDatabase();
});

test('GitHub sign-up creates one user and one personal organization', async () => {
  stubGitHub();
  const app = createApp(async () => {});

  const { state, cookie } = await startSignIn(app);
  const response = await callback(app, `code=${crypto.randomUUID()}&state=${state}`, cookie);

  expect(response.status).toBeGreaterThanOrEqual(300);
  expect(response.status).toBeLessThan(400);

  const users = await prisma.user.findMany();
  expect(users).toHaveLength(1);
  expect(users[0]!.email).toBe('octocat@example.com');

  const organizations = await prisma.organization.findMany();
  expect(organizations).toHaveLength(1);
  expect(organizations[0]!.name).toBe(GITHUB_ACCOUNT.name);
  expect(organizations[0]!.slug).toMatch(/^octo-cat-[A-Za-z0-9]{6}$/);

  const members = await prisma.member.findMany();
  expect(members).toHaveLength(1);
  expect(members[0]!.userId).toBe(users[0]!.id);
  expect(members[0]!.organizationId).toBe(organizations[0]!.id);
  expect(members[0]!.role).toBe('owner');
});

test('second sign-in for the same account does not duplicate the organization', async () => {
  // This account hides its email, so it also covers the noreply fallback.
  stubGitHub({ email: null });
  const app = createApp(async () => {});

  const first = await startSignIn(app);
  await callback(app, `code=${crypto.randomUUID()}&state=${first.state}`, first.cookie);

  const second = await startSignIn(app);
  const response = await callback(
    app,
    `code=${crypto.randomUUID()}&state=${second.state}`,
    second.cookie,
  );

  expect(response.status).toBeGreaterThanOrEqual(300);
  expect(response.status).toBeLessThan(400);

  const users = await prisma.user.findMany();
  expect(users).toHaveLength(1);
  expect(users[0]!.email).toBe(
    `${GITHUB_ACCOUNT.id}+${GITHUB_ACCOUNT.login}@users.noreply.github.com`,
  );
  expect(await prisma.organization.count()).toBe(1);
  expect(await prisma.member.count()).toBe(1);
});

test('denied OAuth consent creates nothing', async () => {
  stubGitHub();
  const app = createApp(async () => {});

  const { state, cookie } = await startSignIn(app);
  const response = await callback(app, `error=access_denied&state=${state}`, cookie);

  expect(response.status).toBeGreaterThanOrEqual(300);
  expect(response.status).toBeLessThan(400);
  expect(response.headers.get('location') ?? '').toContain('error');

  expect(await prisma.user.count()).toBe(0);
  expect(await prisma.organization.count()).toBe(0);
  expect(await prisma.member.count()).toBe(0);
});

test('create without termsAccepted returns validation_failed', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();

  const response = await createKey(app, cookie, {
    organizationId: organization.id,
    name: 'laptop',
  });

  expect(response.status).toBe(422);
  const body = (await response.json()) as { code?: string; message?: string };
  expect(body.code).toBe('validation_failed');
  expect(body.message).toContain('staging terms');
  expect(await prisma.apikey.count()).toBe(0);
});

test('create with termsAccepted stores termsAcceptedAt and returns a key once', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();

  const response = await createKey(app, cookie, {
    organizationId: organization.id,
    name: 'laptop',
    termsAccepted: true,
  });

  expect(response.status).toBe(200);
  const created = (await response.json()) as { id: string; key: string; name: string | null };
  expect(created.key).toBeTruthy();
  expect(created.name).toBe('laptop');

  const stored = await prisma.apikey.findUniqueOrThrow({ where: { id: created.id } });
  expect(stored.referenceId).toBe(organization.id);
  expect(stored.termsAcceptedAt).toBeInstanceOf(Date);
  // The raw key is shown once: only a hash is kept.
  expect(stored.key).not.toBe(created.key);

  // Keys are org-owned, so the list needs the organization id; without it the
  // plugin lists user-owned keys instead.
  const list = await app.handle(
    new Request(`${BASE_URL}/api/auth/api-key/list?organizationId=${organization.id}`, {
      headers: { cookie },
    }),
  );
  expect(list.status).toBe(200);
  const listed = (await list.json()) as { apiKeys: Array<Record<string, unknown>>; total: number };
  expect(listed.apiKeys).toHaveLength(1);
  expect(listed.apiKeys[0]!.key).toBeUndefined();
});

test('revoked key no longer authenticates', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();

  const response = await createKey(app, cookie, {
    organizationId: organization.id,
    termsAccepted: true,
  });
  const created = (await response.json()) as { id: string; key: string };

  expect((await auth.api.verifyApiKey({ body: { key: created.key } })).valid).toBe(true);

  const revoked = await revokeKey(app, cookie, created.id);
  expect(revoked.status).toBe(200);

  const verified = await auth.api.verifyApiKey({ body: { key: created.key } });
  expect(verified.valid).toBe(false);
  expect(await prisma.apikey.count()).toBe(0);
});

test('non-owner member cannot create a key', async () => {
  const app = createApp(async () => {});
  await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();

  const memberCookie = await signIn(app, OTHER_GITHUB_ACCOUNT);
  const secondUser = await prisma.user.findFirstOrThrow({
    where: { email: OTHER_GITHUB_ACCOUNT.email! },
  });

  await prisma.member.create({
    data: {
      id: crypto.randomUUID(),
      organizationId: organization.id,
      userId: secondUser.id,
      role: 'member',
    },
  });

  const response = await createKey(app, memberCookie, {
    organizationId: organization.id,
    termsAccepted: true,
  });

  expect(response.status).toBe(403);
  expect(await prisma.apikey.count()).toBe(0);
});
