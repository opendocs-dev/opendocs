import { DAILY_QUOTAS } from '../legacy-limits';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { BASE_URL, cleanDatabase, fakeApiKey, realFetch, signIn, type App } from '../../test/helpers';
import { getPrisma } from '../db';
import { createApp } from '../index';

const prisma = getPrisma();

/** Signs in, then mints a key for the personal organization. */
const mintKey = async (app: App) => {
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();

  const response = await app.handle(
    new Request(`${BASE_URL}/api/auth/api-key/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ organizationId: organization.id, termsAccepted: true }),
    }),
  );
  expect(response.status).toBe(200);

  const created = (await response.json()) as { id: string; key: string };
  return { cookie, organization, ...created };
};

const getPlanInfo = (app: App, headers: Record<string, string>) =>
  app.handle(new Request(`${BASE_URL}/api/v1/plan`, { headers }));

beforeEach(async () => {
  await cleanDatabase();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  await cleanDatabase();
});

test('missing key returns 401', async () => {
  const app = createApp(async () => {});

  const response = await getPlanInfo(app, { 'x-api-key': fakeApiKey() });

  expect(response.status).toBe(401);
});

test('a Free workspace sees its own plan, full quota remaining, and the three-plan matrix', async () => {
  const app = createApp(async () => {});
  const { key } = await mintKey(app);

  const response = await getPlanInfo(app, { 'x-api-key': key });

  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    plan: string;
    quota: { files_left: number; bytes_left: number };
    plans: Array<{ plan: string; quota: { files: number; bytes: number }; capabilities: Record<string, unknown> }>;
  };

  expect(body.plan).toBe('free');
  expect(body.quota).toEqual({
    files_left: DAILY_QUOTAS.free.files,
    bytes_left: DAILY_QUOTAS.free.bytes,
  });
  expect(body.plans.map((entry) => entry.plan)).toEqual(['free', 'pro', 'enterprise']);
});

test("quota left reflects today's uploads", async () => {
  const app = createApp(async () => {});
  const { key, organization } = await mintKey(app);

  const today = new Date();
  const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  await prisma.usageDaily.create({
    data: { organizationId: organization.id, day, files: 5, bytes: BigInt(1024) },
  });

  const response = await getPlanInfo(app, { 'x-api-key': key });

  expect(response.status).toBe(200);
  const body = (await response.json()) as { quota: { files_left: number; bytes_left: number } };
  expect(body.quota.files_left).toBe(DAILY_QUOTAS.free.files - 5);
  expect(body.quota.bytes_left).toBe(DAILY_QUOTAS.free.bytes - 1024);
});

test('an Enterprise workspace is marked as its own plan, with Enterprise capabilities in the matrix', async () => {
  const app = createApp(async () => {});
  const { key, organization } = await mintKey(app);
  await prisma.workspaceBilling.create({ data: { organizationId: organization.id, plan: 'enterprise' } });

  const response = await getPlanInfo(app, { 'x-api-key': key });

  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    plan: string;
    plans: Array<{ plan: string; capabilities: { presetCount: number; storageKinds: string[]; customDomain: boolean } }>;
  };
  expect(body.plan).toBe('enterprise');

  const enterprise = body.plans.find((entry) => entry.plan === 'enterprise')!;
  expect(enterprise.capabilities.presetCount).toBe(3);
  expect(enterprise.capabilities.storageKinds).toEqual(['gdrive', 's3']);
  expect(enterprise.capabilities.customDomain).toBe(true);

  const free = body.plans.find((entry) => entry.plan === 'free')!;
  expect(free.capabilities.storageKinds).toEqual([]);
  expect(free.capabilities.customDomain).toBe(false);
});
