import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { BASE_URL, cleanDatabase, realFetch } from '../test/helpers';
import { getPrisma } from './db';
import { createApp } from './index';

const prisma = getPrisma();

const makeValidToken = () => 'test_token_' + crypto.randomUUID().replace(/-/g, '') + '12345';
const makeShortToken = () => 'test_' + crypto.randomUUID().slice(0, 8);

beforeEach(async () => {
  await cleanDatabase();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  await cleanDatabase();
});

test('off by default returns 404', async () => {
  const origEnabled = process.env.E2E_LOGIN_ENABLED;
  const origToken = process.env.E2E_LOGIN_TOKEN;
  delete process.env.E2E_LOGIN_ENABLED;
  delete process.env.E2E_LOGIN_TOKEN;

  try {
    const app = createApp(async () => {});
    const token = makeValidToken();
    const response = await app.handle(
      new Request(`${BASE_URL}/api/test/login?token=${token}`),
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body).toEqual({
      error: { code: 'not_found', message: 'Route not found' },
    });
  } finally {
    if (origEnabled !== undefined) process.env.E2E_LOGIN_ENABLED = origEnabled;
    else delete process.env.E2E_LOGIN_ENABLED;
    if (origToken !== undefined) process.env.E2E_LOGIN_TOKEN = origToken;
    else delete process.env.E2E_LOGIN_TOKEN;
  }
});

test('wrong token returns 404', async () => {
  const token = makeValidToken();
  const origEnabled = process.env.E2E_LOGIN_ENABLED;
  const origToken = process.env.E2E_LOGIN_TOKEN;
  process.env.E2E_LOGIN_ENABLED = 'true';
  process.env.E2E_LOGIN_TOKEN = token;

  try {
    const app = createApp(async () => {});

    // Missing token
    const resNoToken = await app.handle(new Request(`${BASE_URL}/api/test/login`));
    expect(resNoToken.status).toBe(404);

    // Wrong token of different length
    const resDiffLen = await app.handle(
      new Request(`${BASE_URL}/api/test/login?token=${makeShortToken()}`),
    );
    expect(resDiffLen.status).toBe(404);

    // Wrong token of same length
    const wrongSameLen = 'x'.repeat(token.length);
    const resSameLen = await app.handle(
      new Request(`${BASE_URL}/api/test/login?token=${wrongSameLen}`),
    );
    expect(resSameLen.status).toBe(404);
  } finally {
    if (origEnabled !== undefined) process.env.E2E_LOGIN_ENABLED = origEnabled;
    else delete process.env.E2E_LOGIN_ENABLED;
    if (origToken !== undefined) process.env.E2E_LOGIN_TOKEN = origToken;
    else delete process.env.E2E_LOGIN_TOKEN;
  }
});

test('refuses to boot in production', () => {
  const origEnabled = process.env.E2E_LOGIN_ENABLED;
  const origToken = process.env.E2E_LOGIN_TOKEN;
  const origNodeEnv = process.env.NODE_ENV;

  process.env.E2E_LOGIN_ENABLED = 'true';
  process.env.E2E_LOGIN_TOKEN = makeValidToken();
  process.env.NODE_ENV = 'production';

  try {
    expect(() => createApp(async () => {})).toThrow();
  } finally {
    if (origEnabled !== undefined) process.env.E2E_LOGIN_ENABLED = origEnabled;
    else delete process.env.E2E_LOGIN_ENABLED;
    if (origToken !== undefined) process.env.E2E_LOGIN_TOKEN = origToken;
    else delete process.env.E2E_LOGIN_TOKEN;
    if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
    else delete process.env.NODE_ENV;
  }
});

test('refuses a short token', () => {
  const origEnabled = process.env.E2E_LOGIN_ENABLED;
  const origToken = process.env.E2E_LOGIN_TOKEN;
  const origNodeEnv = process.env.NODE_ENV;

  process.env.E2E_LOGIN_ENABLED = 'true';
  process.env.NODE_ENV = 'development';

  try {
    // Missing token
    delete process.env.E2E_LOGIN_TOKEN;
    expect(() => createApp(async () => {})).toThrow();

    // Short token (< 24 chars)
    process.env.E2E_LOGIN_TOKEN = makeShortToken();
    expect(() => createApp(async () => {})).toThrow();
  } finally {
    if (origEnabled !== undefined) process.env.E2E_LOGIN_ENABLED = origEnabled;
    else delete process.env.E2E_LOGIN_ENABLED;
    if (origToken !== undefined) process.env.E2E_LOGIN_TOKEN = origToken;
    else delete process.env.E2E_LOGIN_TOKEN;
    if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
    else delete process.env.NODE_ENV;
  }
});

test('sets a session cookie and redirects', async () => {
  const token = makeValidToken();
  const origEnabled = process.env.E2E_LOGIN_ENABLED;
  const origToken = process.env.E2E_LOGIN_TOKEN;
  const origNodeEnv = process.env.NODE_ENV;

  process.env.E2E_LOGIN_ENABLED = 'true';
  process.env.E2E_LOGIN_TOKEN = token;
  process.env.NODE_ENV = 'development';

  try {
    const app = createApp(async () => {});
    const res = await app.handle(
      new Request(`${BASE_URL}/api/test/login?token=${token}`),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/dashboard');

    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('session_token=');

    // Verify session works with /api/v1/me
    const cookieHeader = res.headers
      .getSetCookie()
      .map((entry) => entry.split(';')[0])
      .filter((entry) => entry.includes('session_token='))
      .join('; ');

    const meRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/me`, {
        headers: { cookie: cookieHeader },
      }),
    );
    expect(meRes.status).toBe(200);
    const meBody = (await meRes.json()) as { workspace: { name: string }; role?: string };
    expect(meBody.workspace).toBeDefined();
    expect(meBody.role).toBe('owner');
  } finally {
    if (origEnabled !== undefined) process.env.E2E_LOGIN_ENABLED = origEnabled;
    else delete process.env.E2E_LOGIN_ENABLED;
    if (origToken !== undefined) process.env.E2E_LOGIN_TOKEN = origToken;
    else delete process.env.E2E_LOGIN_TOKEN;
    if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
    else delete process.env.NODE_ENV;
  }
});

test('reuses the same user', async () => {
  const token = makeValidToken();
  const origEnabled = process.env.E2E_LOGIN_ENABLED;
  const origToken = process.env.E2E_LOGIN_TOKEN;
  const origNodeEnv = process.env.NODE_ENV;

  process.env.E2E_LOGIN_ENABLED = 'true';
  process.env.E2E_LOGIN_TOKEN = token;
  process.env.NODE_ENV = 'development';

  try {
    const app = createApp(async () => {});

    // First call
    const res1 = await app.handle(
      new Request(`${BASE_URL}/api/test/login?token=${token}`),
    );
    expect(res1.status).toBe(302);

    // Second call
    const res2 = await app.handle(
      new Request(`${BASE_URL}/api/test/login?token=${token}`),
    );
    expect(res2.status).toBe(302);

    const users = await prisma.user.findMany({
      where: { email: 'e2e@opendocs.test' },
    });
    expect(users.length).toBe(1);

    const members = await prisma.member.findMany({
      where: { userId: users[0]!.id },
    });
    expect(members.length).toBe(1);
  } finally {
    if (origEnabled !== undefined) process.env.E2E_LOGIN_ENABLED = origEnabled;
    else delete process.env.E2E_LOGIN_ENABLED;
    if (origToken !== undefined) process.env.E2E_LOGIN_TOKEN = origToken;
    else delete process.env.E2E_LOGIN_TOKEN;
    if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
    else delete process.env.NODE_ENV;
  }
});

test('applies role and plan', async () => {
  const token = makeValidToken();
  const origEnabled = process.env.E2E_LOGIN_ENABLED;
  const origToken = process.env.E2E_LOGIN_TOKEN;
  const origNodeEnv = process.env.NODE_ENV;

  process.env.E2E_LOGIN_ENABLED = 'true';
  process.env.E2E_LOGIN_TOKEN = token;
  process.env.NODE_ENV = 'development';

  try {
    const app = createApp(async () => {});

    // Set role=editor and plan=pro
    const resEditor = await app.handle(
      new Request(`${BASE_URL}/api/test/login?token=${token}&role=editor&plan=pro`),
    );
    expect(resEditor.status).toBe(302);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'e2e@opendocs.test' },
    });
    const member = await prisma.member.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(member.role).toBe('editor');

    const billing = await prisma.workspaceBilling.findUniqueOrThrow({
      where: { organizationId: member.organizationId },
    });
    expect(billing.plan).toBe('pro');

    // Update to role=admin and plan=enterprise
    const resAdmin = await app.handle(
      new Request(`${BASE_URL}/api/test/login?token=${token}&role=admin&plan=enterprise`),
    );
    expect(resAdmin.status).toBe(302);

    const memberUpdated = await prisma.member.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(memberUpdated.role).toBe('admin');

    const billingUpdated = await prisma.workspaceBilling.findUniqueOrThrow({
      where: { organizationId: member.organizationId },
    });
    expect(billingUpdated.plan).toBe('enterprise');

    // Invalid role -> 422
    const resBadRole = await app.handle(
      new Request(`${BASE_URL}/api/test/login?token=${token}&role=invalid`),
    );
    expect(resBadRole.status).toBe(422);
    const badRoleBody = (await resBadRole.json()) as { error: { code: string } };
    expect(badRoleBody.error.code).toBe('validation_failed');

    // Invalid plan -> 422
    const resBadPlan = await app.handle(
      new Request(`${BASE_URL}/api/test/login?token=${token}&plan=ultra`),
    );
    expect(resBadPlan.status).toBe(422);
    const badPlanBody = (await resBadPlan.json()) as { error: { code: string } };
    expect(badPlanBody.error.code).toBe('validation_failed');
  } finally {
    if (origEnabled !== undefined) process.env.E2E_LOGIN_ENABLED = origEnabled;
    else delete process.env.E2E_LOGIN_ENABLED;
    if (origToken !== undefined) process.env.E2E_LOGIN_TOKEN = origToken;
    else delete process.env.E2E_LOGIN_TOKEN;
    if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
    else delete process.env.NODE_ENV;
  }
});

test('rejects bad next', async () => {
  const token = makeValidToken();
  const origEnabled = process.env.E2E_LOGIN_ENABLED;
  const origToken = process.env.E2E_LOGIN_TOKEN;
  const origNodeEnv = process.env.NODE_ENV;

  process.env.E2E_LOGIN_ENABLED = 'true';
  process.env.E2E_LOGIN_TOKEN = token;
  process.env.NODE_ENV = 'development';

  try {
    const app = createApp(async () => {});

    // Missing leading slash
    const resNoSlash = await app.handle(
      new Request(`${BASE_URL}/api/test/login?token=${token}&next=dashboard`),
    );
    expect(resNoSlash.status).toBe(422);
    const bodyNoSlash = (await resNoSlash.json()) as { error: { code: string } };
    expect(bodyNoSlash.error.code).toBe('validation_failed');

    // Double leading slash (protocol-relative URL)
    const resDoubleSlash = await app.handle(
      new Request(`${BASE_URL}/api/test/login?token=${token}&next=//evil.com`),
    );
    expect(resDoubleSlash.status).toBe(422);
    const bodyDoubleSlash = (await resDoubleSlash.json()) as { error: { code: string } };
    expect(bodyDoubleSlash.error.code).toBe('validation_failed');

    // Backslash
    const resBackslash = await app.handle(
      new Request(`${BASE_URL}/api/test/login?token=${token}&next=/dash\\board`),
    );
    expect(resBackslash.status).toBe(422);
    const bodyBackslash = (await resBackslash.json()) as { error: { code: string } };
    expect(bodyBackslash.error.code).toBe('validation_failed');

    // Valid next -> 302 with Location
    const resValid = await app.handle(
      new Request(`${BASE_URL}/api/test/login?token=${token}&next=/dashboard/site`),
    );
    expect(resValid.status).toBe(302);
    expect(resValid.headers.get('location')).toBe('/dashboard/site');
  } finally {
    if (origEnabled !== undefined) process.env.E2E_LOGIN_ENABLED = origEnabled;
    else delete process.env.E2E_LOGIN_ENABLED;
    if (origToken !== undefined) process.env.E2E_LOGIN_TOKEN = origToken;
    else delete process.env.E2E_LOGIN_TOKEN;
    if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
    else delete process.env.NODE_ENV;
  }
});
