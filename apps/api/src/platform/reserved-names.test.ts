import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { BASE_URL, cleanDatabase, GITHUB_ACCOUNT, realFetch, signIn, type App } from '../../test/helpers';
import { getPrisma } from '../db';
import { createApp } from '../index';
import { LocalDiskProvider } from '../storage/local';

const prisma = getPrisma();

// Distinct from the 12 names the site-foundation migration seeds permanently
// (www, api, admin, app, i, mail, docs, status, support, opendocs, login, paypal).
const TEST_RESERVED_NAME = 'brandwatch';
const TEST_RESERVED_NAMES = [TEST_RESERVED_NAME, 'brandwatch2'];

const newApp = async (): Promise<App> => {
  const root = await mkdtemp(join(tmpdir(), 'od-platform-'));
  return createApp(async () => {}, {
    provider: new LocalDiskProvider(root),
    accounts: ['local'],
  });
};

const errorCode = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

const withAdminEnv = async (fn: () => Promise<void>) => {
  const previous = process.env.PLATFORM_ADMIN_EMAILS;
  process.env.PLATFORM_ADMIN_EMAILS = GITHUB_ACCOUNT.email ?? '';
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
    else process.env.PLATFORM_ADMIN_EMAILS = previous;
  }
};

const removeTestReservedNames = () =>
  prisma.reservedName.deleteMany({ where: { name: { in: TEST_RESERVED_NAMES } } });

beforeEach(async () => {
  await cleanDatabase();
  await removeTestReservedNames();
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete process.env.PLATFORM_ADMIN_EMAILS;
  await removeTestReservedNames();
});

afterAll(async () => {
  await cleanDatabase();
  await removeTestReservedNames();
});

test('GET /api/v1/platform/reserved-names lists reserved names for an allow-listed admin', () =>
  withAdminEnv(async () => {
    const app = await newApp();
    const cookie = await signIn(app);

    await prisma.reservedName.create({ data: { name: TEST_RESERVED_NAME, reason: 'System' } });

    const response = await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/reserved-names`, { headers: { cookie } }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { reserved_names: { name: string; reason: string }[] };
    expect(body.reserved_names).toContainEqual({ name: TEST_RESERVED_NAME, reason: 'System' });
  }));

test('GET /api/v1/platform/reserved-names rejects a non-allow-listed user with 403', async () => {
  const app = await newApp();
  const cookie = await signIn(app);

  const response = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/reserved-names`, { headers: { cookie } }),
  );

  expect(response.status).toBe(403);
  expect(await errorCode(response)).toBe('unauthorized');
});

test('GET /api/v1/platform/reserved-names rejects an anonymous caller with 401', async () => {
  const app = await newApp();

  const response = await app.handle(new Request(`${BASE_URL}/api/v1/platform/reserved-names`));

  expect(response.status).toBe(401);
  expect(await errorCode(response)).toBe('unauthorized');
});

test('POST /api/v1/platform/reserved-names adds a reserved name', () =>
  withAdminEnv(async () => {
    const app = await newApp();
    const cookie = await signIn(app);

    const response = await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/reserved-names`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Brandwatch', reason: 'Brand' }),
      }),
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { name: string; reason: string };
    expect(body).toEqual({ name: TEST_RESERVED_NAME, reason: 'Brand' });

    const row = await prisma.reservedName.findUnique({ where: { name: TEST_RESERVED_NAME } });
    expect(row?.reason).toBe('Brand');
  }));

test('POST /api/v1/platform/reserved-names with a duplicate name returns 409', () =>
  withAdminEnv(async () => {
    const app = await newApp();
    const cookie = await signIn(app);
    await prisma.reservedName.create({ data: { name: TEST_RESERVED_NAME, reason: 'System' } });

    const response = await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/reserved-names`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name: TEST_RESERVED_NAME, reason: 'Trust' }),
      }),
    );

    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe('validation_failed');
  }));

test('POST /api/v1/platform/reserved-names with an invalid name returns 422', () =>
  withAdminEnv(async () => {
    const app = await newApp();
    const cookie = await signIn(app);

    const response = await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/reserved-names`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'a', reason: 'System' }),
      }),
    );

    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe('validation_failed');
  }));

test('POST /api/v1/platform/reserved-names without a reason returns 422', () =>
  withAdminEnv(async () => {
    const app = await newApp();
    const cookie = await signIn(app);

    const response = await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/reserved-names`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name: TEST_RESERVED_NAME, reason: '' }),
      }),
    );

    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe('validation_failed');
  }));

test('POST /api/v1/platform/reserved-names rejects a non-allow-listed user with 403', async () => {
  const app = await newApp();
  const cookie = await signIn(app);

  const response = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/reserved-names`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: TEST_RESERVED_NAME, reason: 'Brand' }),
    }),
  );

  expect(response.status).toBe(403);

  const row = await prisma.reservedName.findUnique({ where: { name: TEST_RESERVED_NAME } });
  expect(row).toBeNull();
});

test('DELETE /api/v1/platform/reserved-names/:name removes it', () =>
  withAdminEnv(async () => {
    const app = await newApp();
    const cookie = await signIn(app);
    await prisma.reservedName.create({ data: { name: TEST_RESERVED_NAME, reason: 'System' } });

    const response = await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/reserved-names/${TEST_RESERVED_NAME}`, {
        method: 'DELETE',
        headers: { cookie },
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    const row = await prisma.reservedName.findUnique({ where: { name: TEST_RESERVED_NAME } });
    expect(row).toBeNull();
  }));

test('DELETE /api/v1/platform/reserved-names/:name for a missing name returns 404', () =>
  withAdminEnv(async () => {
    const app = await newApp();
    const cookie = await signIn(app);

    const response = await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/reserved-names/ghost-name-x`, {
        method: 'DELETE',
        headers: { cookie },
      }),
    );

    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe('not_found');
  }));

test('DELETE /api/v1/platform/reserved-names/:name rejects a non-allow-listed user with 403', async () => {
  const app = await newApp();
  const cookie = await signIn(app);
  await prisma.reservedName.create({ data: { name: TEST_RESERVED_NAME, reason: 'System' } });

  const response = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/reserved-names/${TEST_RESERVED_NAME}`, {
      method: 'DELETE',
      headers: { cookie },
    }),
  );

  expect(response.status).toBe(403);

  const row = await prisma.reservedName.findUnique({ where: { name: TEST_RESERVED_NAME } });
  expect(row).not.toBeNull();
});

test('GET /api/v1/platform/reserved-names/check reports a reserved name', () =>
  withAdminEnv(async () => {
    const app = await newApp();
    const cookie = await signIn(app);
    await prisma.reservedName.create({ data: { name: TEST_RESERVED_NAME, reason: 'System' } });

    const response = await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/reserved-names/check?name=${TEST_RESERVED_NAME}`, {
        headers: { cookie },
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; reason?: string };
    expect(body).toEqual({ status: 'reserved', reason: 'System' });
  }));

test('GET /api/v1/platform/reserved-names/check reports an already-used org slug', () =>
  withAdminEnv(async () => {
    const app = await newApp();
    const cookie = await signIn(app);

    const current = await app.handle(
      new Request(`${BASE_URL}/api/auth/get-session`, { headers: { cookie } }),
    );
    const organizationId = ((await current.json()) as { session: { activeOrganizationId: string } }).session
      .activeOrganizationId;
    await prisma.organization.update({ where: { id: organizationId }, data: { slug: 'octocat-co' } });

    const response = await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/reserved-names/check?name=octocat-co`, { headers: { cookie } }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe('taken');
  }));

test('GET /api/v1/platform/reserved-names/check reports an available name', () =>
  withAdminEnv(async () => {
    const app = await newApp();
    const cookie = await signIn(app);

    const response = await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/reserved-names/check?name=totally-unclaimed-slug`, {
        headers: { cookie },
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe('available');
  }));

test('GET /api/v1/platform/reserved-names/check reports an invalid name', () =>
  withAdminEnv(async () => {
    const app = await newApp();
    const cookie = await signIn(app);

    const response = await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/reserved-names/check?name=a`, { headers: { cookie } }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; reason?: string };
    expect(body.status).toBe('invalid');
  }));

test('GET /api/v1/platform/reserved-names/check rejects a non-allow-listed user with 403', async () => {
  const app = await newApp();
  const cookie = await signIn(app);

  const response = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/reserved-names/check?name=anything`, { headers: { cookie } }),
  );

  expect(response.status).toBe(403);
});
