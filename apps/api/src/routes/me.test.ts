import { CLI_MIN_VERSION, MeResponseSchema } from '@opendocs/core';
import { DAILY_QUOTAS } from '../legacy-limits';
import { Value } from '@sinclair/typebox/value';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import {
  BASE_URL,
  cleanDatabase,
  fakeApiKey,
  realFetch,
  signIn,
  type App,
} from '../../test/helpers';
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

const getMe = (app: App, headers: Record<string, string>) =>
  app.handle(new Request(`${BASE_URL}/api/v1/me`, { headers }));

beforeEach(async () => {
  await cleanDatabase();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  await cleanDatabase();
});

test('valid key returns workspace, quota, min CLI version', async () => {
  const app = createApp(async () => {});
  const { key, organization } = await mintKey(app);

  const response = await getMe(app, { 'x-api-key': key });

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(Value.Check(MeResponseSchema, body)).toBe(true);
  expect(body).toEqual({
    workspace: { id: organization.id, name: organization.name, slug: organization.slug },
    quota: { files_left: DAILY_QUOTAS.free.files, bytes_left: DAILY_QUOTAS.free.bytes },
    min_cli_version: CLI_MIN_VERSION,
    site_host: null,
  });
});

test('missing key returns 401', async () => {
  const app = createApp(async () => {});

  const noHeader = await getMe(app, {});
  expect(noHeader.status).toBe(401);
  expect(await noHeader.json()).toEqual({
    error: { code: 'unauthorized', message: 'A valid API key or session is required' },
  });

  const unknownKey = await getMe(app, { 'x-api-key': fakeApiKey() });
  expect(unknownKey.status).toBe(401);
});

test('revoked key returns 401', async () => {
  const app = createApp(async () => {});
  const { cookie, id, key } = await mintKey(app);

  expect((await getMe(app, { 'x-api-key': key })).status).toBe(200);

  const revoked = await app.handle(
    new Request(`${BASE_URL}/api/auth/api-key/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ keyId: id }),
    }),
  );
  expect(revoked.status).toBe(200);

  expect((await getMe(app, { 'x-api-key': key })).status).toBe(401);
});

test('session cookie returns the active workspace', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();

  const response = await getMe(app, { cookie });

  expect(response.status).toBe(200);
  const body = (await response.json()) as { workspace: { id: string; name: string; slug: string } };
  expect(Value.Check(MeResponseSchema, body)).toBe(true);
  expect(body.workspace).toEqual({ id: organization.id, name: organization.name, slug: organization.slug });
});

test('no usage row yet returns full quota', async () => {
  const app = createApp(async () => {});
  const { key } = await mintKey(app);

  const response = await getMe(app, { 'x-api-key': key });

  expect(response.status).toBe(200);
  const body = (await response.json()) as { quota: { files_left: number; bytes_left: number } };
  // Nothing has been uploaded, so the Free allowance is reported untouched.
  expect(body.quota).toEqual({
    files_left: DAILY_QUOTAS.free.files,
    bytes_left: DAILY_QUOTAS.free.bytes,
  });
});

test("quota left reflects today's usage", async () => {
  const app = createApp(async () => {});
  const { key, organization } = await mintKey(app);

  const today = new Date();
  const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  await prisma.usageDaily.create({
    data: { organizationId: organization.id, day, files: 5, bytes: BigInt(1024) },
  });

  const response = await getMe(app, { 'x-api-key': key });

  expect(response.status).toBe(200);
  const body = (await response.json()) as { quota: { files_left: number; bytes_left: number } };
  expect(body.quota).toEqual({
    files_left: DAILY_QUOTAS.free.files - 5,
    bytes_left: DAILY_QUOTAS.free.bytes - 1024,
  });
});

test('an unknown stored plan still returns a plan-less me response', async () => {
  const app = createApp(async () => {});
  const { key, organization } = await mintKey(app);
  await prisma.workspaceBilling.create({
    data: { organizationId: organization.id, plan: 'enterprise-legacy' },
  });

  const response = await getMe(app, { 'x-api-key': key });

  expect(response.status).toBe(200);
  const body = (await response.json()) as { plan?: string; quota: { files_left: number } };
  expect(body.plan).toBeUndefined();
  expect(body.quota.files_left).toBe(DAILY_QUOTAS.free.files);
});

test('session caller gets role', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();

  const response = await getMe(app, { cookie });

  expect(response.status).toBe(200);
  const body = (await response.json()) as { role: string };
  expect(body.role).toBe('owner');
});

test('session caller with member role sees it as editor', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();
  const member = await prisma.member.findFirstOrThrow({
    where: { organizationId: organization.id },
  });

  // Change the member's role to 'member' (legacy)
  await prisma.member.update({
    where: { id: member.id },
    data: { role: 'member' },
  });

  const response = await getMe(app, { cookie });

  expect(response.status).toBe(200);
  const body = (await response.json()) as { role: string };
  expect(body.role).toBe('editor');
});

test('API key caller does not get role', async () => {
  const app = createApp(async () => {});
  const { key } = await mintKey(app);

  const response = await getMe(app, { 'x-api-key': key });

  expect(response.status).toBe(200);
  const body = (await response.json()) as Record<string, unknown>;
  expect(body.role).toBeUndefined();
});

test('site_host is null when TENANT_BASE_DOMAIN is unset', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  const response = await getMe(app, { cookie });

  expect(response.status).toBe(200);
  const body = (await response.json()) as { site_host: string | null };
  expect(body.site_host).toBeNull();
});

test('site_host is slug.base when TENANT_BASE_DOMAIN is set', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();

  const oldBase = process.env.TENANT_BASE_DOMAIN;
  process.env.TENANT_BASE_DOMAIN = 'example.com';

  try {
    const response = await getMe(app, { cookie });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { site_host: string | null };
    expect(body.site_host).toBe(`${organization.slug}.example.com`);
  } finally {
    if (oldBase === undefined) delete process.env.TENANT_BASE_DOMAIN;
    else process.env.TENANT_BASE_DOMAIN = oldBase;
  }
});
