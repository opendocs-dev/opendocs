import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import {
  BASE_URL,
  cleanDatabase,
  realFetch,
  signIn,
  type App,
} from '../../test/helpers';
import { getPrisma } from '../db';
import { createApp } from '../index';

const prisma = getPrisma();

const createKey = (app: App, cookie: string, body: Record<string, unknown>) =>
  app.handle(
    new Request(`${BASE_URL}/api/auth/api-key/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    }),
  );

const listKeys = (app: App, cookie: string) =>
  app.handle(
    new Request(`${BASE_URL}/api/auth/api-key/list`, {
      method: 'GET',
      headers: { cookie },
    }),
  );

const deleteKey = (app: App, cookie: string, keyId: string) =>
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

test('owner can create API key', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();

  const response = await createKey(app, cookie, {
    organizationId: organization.id,
    termsAccepted: true,
  });

  expect(response.status).toBe(200);
});

test('admin can create API key', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();
  const member = await prisma.member.findFirstOrThrow();

  // Change the member's role to admin
  await prisma.member.update({
    where: { id: member.id },
    data: { role: 'admin' },
  });

  const response = await createKey(app, cookie, {
    organizationId: organization.id,
    termsAccepted: true,
  });

  expect(response.status).toBe(200);
});

test('editor cannot create API key (403)', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();
  const member = await prisma.member.findFirstOrThrow();

  // Change the member's role to editor
  await prisma.member.update({
    where: { id: member.id },
    data: { role: 'editor' },
  });

  const response = await createKey(app, cookie, {
    organizationId: organization.id,
    termsAccepted: true,
  });

  expect(response.status).toBe(403);
  const body = (await response.json()) as { error: { code: string; message: string } };
  expect(body.error.code).toBe('unauthorized');
  expect(body.error.message).toContain('Only owners and admins');
});

test('no session returns 401', async () => {
  const app = createApp(async () => {});

  const response = await app.handle(
    new Request(`${BASE_URL}/api/auth/api-key/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId: 'org1', termsAccepted: true }),
    }),
  );

  expect(response.status).toBe(401);
  const body = (await response.json()) as { error: { code: string; message: string } };
  expect(body.error.code).toBe('unauthorized');
  expect(body.error.message).toContain('A valid session is required');
});

test('owner can list API keys', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();

  // Create a key first
  const createResp = await createKey(app, cookie, {
    organizationId: organization.id,
    termsAccepted: true,
  });
  expect(createResp.status).toBe(200);

  const response = await listKeys(app, cookie);

  expect(response.status).toBe(200);
});

test('editor cannot list API keys (403)', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const member = await prisma.member.findFirstOrThrow();

  // Change the member's role to editor
  await prisma.member.update({
    where: { id: member.id },
    data: { role: 'editor' },
  });

  const response = await listKeys(app, cookie);

  expect(response.status).toBe(403);
});

test('owner can delete API key', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();

  // Create a key first
  const createResp = await createKey(app, cookie, {
    organizationId: organization.id,
    termsAccepted: true,
  });
  expect(createResp.status).toBe(200);
  const created = (await createResp.json()) as { id: string };

  const response = await deleteKey(app, cookie, created.id);

  expect(response.status).toBe(200);
});

test('editor cannot delete API key (403)', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();
  const member = await prisma.member.findFirstOrThrow();

  // Create a key as owner first
  const createResp = await createKey(app, cookie, {
    organizationId: organization.id,
    termsAccepted: true,
  });
  expect(createResp.status).toBe(200);
  const created = (await createResp.json()) as { id: string };

  // Change to editor
  await prisma.member.update({
    where: { id: member.id },
    data: { role: 'editor' },
  });

  const response = await deleteKey(app, cookie, created.id);

  expect(response.status).toBe(403);
});
