import { CLI_MIN_VERSION, MeResponseSchema } from '@opendocs/core';
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
import { resetEnvForTest } from '../env';
import { createApp } from '../index';

const prisma = getPrisma();

/** Signs in, then mints a key for the instance workspace. */
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

test('valid key returns workspace and min CLI version, with no quota or site_host', async () => {
  const app = createApp(async () => {});
  const { key, organization } = await mintKey(app);

  const response = await getMe(app, { 'x-api-key': key });

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(Value.Check(MeResponseSchema, body)).toBe(true);
  expect(body).toEqual({
    workspace: { id: organization.id, name: organization.name, slug: organization.slug },
    min_cli_version: CLI_MIN_VERSION,
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

/** Runs `fn` with STORAGE_QUOTA_BYTES set (or unset when null), restoring the env afterwards. */
const withQuota = async (value: string | null, fn: () => Promise<void>) => {
  const old = process.env.STORAGE_QUOTA_BYTES;
  if (value === null) delete process.env.STORAGE_QUOTA_BYTES;
  else process.env.STORAGE_QUOTA_BYTES = value;
  resetEnvForTest();
  try {
    await fn();
  } finally {
    if (old === undefined) delete process.env.STORAGE_QUOTA_BYTES;
    else process.env.STORAGE_QUOTA_BYTES = old;
    resetEnvForTest();
  }
};

test('me.quota hidden when no cap', async () => {
  const app = createApp(async () => {});
  const { key } = await mintKey(app);

  await withQuota(null, async () => {
    const response = await getMe(app, { 'x-api-key': key });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Value.Check(MeResponseSchema, body)).toBe(true);
    expect(body.quota).toBeUndefined();
    expect(body.site_host).toBeUndefined();
  });
});

test('me.quota present and filled from env when STORAGE_QUOTA_BYTES>0', async () => {
  const app = createApp(async () => {});
  const { key, organization } = await mintKey(app);

  await withQuota('1000000', async () => {
    const empty = await getMe(app, { 'x-api-key': key });
    expect(empty.status).toBe(200);
    const emptyBody = (await empty.json()) as { quota: { files_left: number; bytes_left: number } };
    expect(emptyBody.quota).toEqual({ files_left: Number.MAX_SAFE_INTEGER, bytes_left: 1000000 });

    await prisma.asset.create({
      data: {
        publicId: 'quota-asset',
        organizationId: organization.id,
        kind: 'step',
        providerFileId: 'file-1',
        mime: 'image/png',
        bytes: 400,
        width: 1,
        height: 1,
        sha256: 'a'.repeat(64),
      },
    });

    const used = await getMe(app, { 'x-api-key': key });
    const usedBody = (await used.json()) as { quota: { files_left: number; bytes_left: number } };
    expect(Value.Check(MeResponseSchema, usedBody)).toBe(true);
    expect(usedBody.quota).toEqual({ files_left: Number.MAX_SAFE_INTEGER, bytes_left: 999600 });
  });
});
