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
    notify_ai_credits: boolean;
    notify_content_gaps: boolean;
    notify_invite_accepted: boolean;
    github_handle: string | null;
  };
  expect(body.name).toBe(GITHUB_ACCOUNT.name);
  expect(body.email).toBe(GITHUB_ACCOUNT.email!);
  expect(body.email_notifications).toBe(true);
  expect(body.notify_weekly_digest).toBe(true);
  expect(body.notify_ai_credits).toBe(true);
  expect(body.notify_content_gaps).toBe(true);
  expect(body.notify_invite_accepted).toBe(true);
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

test('PATCH /api/v1/account updates individual notification toggles', async () => {
  const app = newApp();
  const cookie = await signIn(app, GITHUB_ACCOUNT);

  const response = await app.handle(
    new Request(`${BASE_URL}/api/v1/account`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ notify_weekly_digest: false, notify_ai_credits: false }),
    }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    notify_weekly_digest: boolean;
    notify_ai_credits: boolean;
    notify_content_gaps: boolean;
    notify_invite_accepted: boolean;
    email_notifications: boolean;
  };
  expect(body.notify_weekly_digest).toBe(false);
  expect(body.notify_ai_credits).toBe(false);
  expect(body.notify_content_gaps).toBe(true);
  expect(body.notify_invite_accepted).toBe(true);
  expect(body.email_notifications).toBe(true); // Derived: other 2 are still true

  const user = await prisma.user.findFirstOrThrow({ where: { email: GITHUB_ACCOUNT.email! } });
  expect(user.notifyWeeklyDigest).toBe(false);
  expect(user.notifyAiCredits).toBe(false);
  expect(user.notifyContentGaps).toBe(true);
  expect(user.emailNotifications).toBe(true);
});

test('PATCH /api/v1/account legacy email_notifications syncs all toggles', async () => {
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
    notify_ai_credits: boolean;
    notify_content_gaps: boolean;
    notify_invite_accepted: boolean;
  };
  expect(body.email_notifications).toBe(false);
  expect(body.notify_weekly_digest).toBe(false);
  expect(body.notify_ai_credits).toBe(false);
  expect(body.notify_content_gaps).toBe(false);
  expect(body.notify_invite_accepted).toBe(false);

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
