import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { BASE_URL, cleanDatabase, GITHUB_ACCOUNT, realFetch, signIn, type App } from '../../test/helpers';
import { getPrisma } from '../db';
import { createApp } from '../index';

const prisma = getPrisma();

const newApp = (): App => createApp(async () => {});

beforeEach(async () => {
  await cleanDatabase();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  await cleanDatabase();
});

test('GET /api/v1/account returns profile, handle, and defaults notifications on', async () => {
  const app = newApp();
  const cookie = await signIn(app, GITHUB_ACCOUNT);

  const response = await app.handle(new Request(`${BASE_URL}/api/v1/account`, { headers: { cookie } }));
  expect(response.status).toBe(200);

  const body = (await response.json()) as {
    name: string;
    email: string;
    image: string | null;
    email_notifications: boolean;
    notify_weekly_digest: boolean;
    github_handle: string | null;
  };
  expect(body.name).toBe(GITHUB_ACCOUNT.name);
  expect(body.email).toBe(GITHUB_ACCOUNT.email!);
  expect(body.email_notifications).toBe(true);
  expect(body.notify_weekly_digest).toBe(true);
  expect(body.github_handle).toBe(GITHUB_ACCOUNT.login);
});

test('GET /api/v1/account requires a session', async () => {
  const app = newApp();
  const response = await app.handle(new Request(`${BASE_URL}/api/v1/account`));
  expect(response.status).toBe(401);
});

test('PATCH /api/v1/account updates name (1-80 chars) and persists it', async () => {
  const app = newApp();
  const cookie = await signIn(app, GITHUB_ACCOUNT);

  const response = await app.handle(
    new Request(`${BASE_URL}/api/v1/account`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Octo Renamed' }),
    }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { name: string };
  expect(body.name).toBe('Octo Renamed');

  const user = await prisma.user.findFirstOrThrow({ where: { email: GITHUB_ACCOUNT.email! } });
  expect(user.name).toBe('Octo Renamed');
});

test('PATCH /api/v1/account rejects invalid name length', async () => {
  const app = newApp();
  const cookie = await signIn(app, GITHUB_ACCOUNT);

  // Empty string
  const resEmpty = await app.handle(
    new Request(`${BASE_URL}/api/v1/account`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    }),
  );
  expect(resEmpty.status).toBe(422);

  // Over 80 chars
  const resLong = await app.handle(
    new Request(`${BASE_URL}/api/v1/account`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'a'.repeat(81) }),
    }),
  );
  expect(resLong.status).toBe(422);
});

test('PATCH /api/v1/account updates the weekly digest toggle and keeps email_notifications in sync', async () => {
  const app = newApp();
  const cookie = await signIn(app, GITHUB_ACCOUNT);

  const response = await app.handle(
    new Request(`${BASE_URL}/api/v1/account`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ notify_weekly_digest: false }),
    }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    notify_weekly_digest: boolean;
    email_notifications: boolean;
  };
  expect(body.notify_weekly_digest).toBe(false);
  expect(body.email_notifications).toBe(false); // Kept in sync with the weekly digest

  const user = await prisma.user.findFirstOrThrow({ where: { email: GITHUB_ACCOUNT.email! } });
  expect(user.notifyWeeklyDigest).toBe(false);
  expect(user.emailNotifications).toBe(false);
});

test('PATCH /api/v1/account legacy email_notifications syncs the weekly digest', async () => {
  const app = newApp();
  const cookie = await signIn(app, GITHUB_ACCOUNT);

  const response = await app.handle(
    new Request(`${BASE_URL}/api/v1/account`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ email_notifications: false }),
    }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    email_notifications: boolean;
    notify_weekly_digest: boolean;
  };
  expect(body.email_notifications).toBe(false);
  expect(body.notify_weekly_digest).toBe(false);

  const user = await prisma.user.findFirstOrThrow({ where: { email: GITHUB_ACCOUNT.email! } });
  expect(user.emailNotifications).toBe(false);
  expect(user.notifyWeeklyDigest).toBe(false);
});

test('PATCH /api/v1/account with non-boolean toggle returns 422', async () => {
  const app = newApp();
  const cookie = await signIn(app, GITHUB_ACCOUNT);

  const response = await app.handle(
    new Request(`${BASE_URL}/api/v1/account`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ notify_weekly_digest: 'invalid' }),
    }),
  );
  expect(response.status).toBe(422);
});

test('PATCH /api/v1/account requires a session', async () => {
  const app = newApp();
  const response = await app.handle(
    new Request(`${BASE_URL}/api/v1/account`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email_notifications: false }),
    }),
  );
  expect(response.status).toBe(401);
});
