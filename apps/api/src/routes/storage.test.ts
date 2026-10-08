import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { BASE_URL, cleanDatabase, OTHER_GITHUB_ACCOUNT, realFetch, signIn, type App, type GitHubAccount } from '../../test/helpers';
import { getPrisma } from '../db';
import { createApp } from '../index';
import type { StorageConnection } from '../../generated/prisma/client';
import type { StorageProvider } from '../storage/provider';

const prisma = getPrisma();

/** A real in-memory round-trip provider: whatever bytes are uploaded come back unchanged on read. */
const fakeProvider = (name: string, behaviour: Partial<StorageProvider> = {}): StorageProvider => {
  const objects = new Map<string, Uint8Array>();
  return {
    name,
    upload:
      behaviour.upload ??
      (async (_account, _key, bytes) => {
        const fileId = crypto.randomUUID();
        objects.set(fileId, bytes);
        return { fileId };
      }),
    read: behaviour.read ?? (async (_account, fileId) => objects.get(fileId) ?? new Uint8Array()),
    delete: behaviour.delete ?? (async (_account, fileId) => void objects.delete(fileId)),
  };
};

type Workspace = { app: App; cookie: string; organizationId: string };

const workspace = async (
  plan: 'free' | 'pro' | 'enterprise',
  buildProvider?: (connection: StorageConnection) => StorageProvider,
  account?: Partial<GitHubAccount>,
): Promise<Workspace> => {
  const app = createApp(async () => {}, undefined, buildProvider);
  const cookie = await signIn(app, account);
  const session = await prisma.session.findFirstOrThrow({
    where: { activeOrganizationId: { not: null } },
    orderBy: { createdAt: 'desc' },
  });
  const organizationId = session.activeOrganizationId!;
  if (plan !== 'free') {
    await prisma.workspaceBilling.create({ data: { organizationId, plan } });
  }
  return { app, cookie, organizationId };
};

const errorCode = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

const post = (ws: Workspace, path: string, body?: unknown) =>
  ws.app.handle(
    new Request(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { cookie: ws.cookie, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

const del = (ws: Workspace, path: string) =>
  ws.app.handle(new Request(`${BASE_URL}${path}`, { method: 'DELETE', headers: { cookie: ws.cookie } }));

const get = (ws: Workspace, path: string) =>
  ws.app.handle(new Request(`${BASE_URL}${path}`, { headers: { cookie: ws.cookie } }));

const connectGdrive = (ws: Workspace) =>
  post(ws, '/api/v1/storage/connections', {
    kind: 'gdrive',
    folder_id: 'folder-123',
    refresh_token: 'refresh-token-abc',
  });

const connectS3 = (ws: Workspace) =>
  post(ws, '/api/v1/storage/connections', {
    kind: 's3',
    bucket: 'my-bucket',
    access_key_id: 'access-key',
    secret_access_key: 'secret-key',
  });

beforeEach(async () => {
  await cleanDatabase();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  await cleanDatabase();
});

test('GET /api/v1/storage reports allowed kinds by plan', async () => {
  const free = await workspace('free', undefined, {
    id: 1001,
    login: 'free-ws',
    email: 'free-ws@example.com',
  });
  const pro = await workspace('pro', undefined, OTHER_GITHUB_ACCOUNT);
  const enterprise = await workspace('enterprise', undefined, {
    id: 1002,
    login: 'enterprise-ws',
    email: 'enterprise-ws@example.com',
  });

  expect(((await (await get(free, '/api/v1/storage')).json()) as { allowed_kinds: string[] }).allowed_kinds).toEqual([]);
  expect(((await (await get(pro, '/api/v1/storage')).json()) as { allowed_kinds: string[] }).allowed_kinds).toEqual(['gdrive']);
  expect(
    ((await (await get(enterprise, '/api/v1/storage')).json()) as { allowed_kinds: string[] }).allowed_kinds,
  ).toEqual(['gdrive', 's3']);
});

test('a Free workspace cannot connect a Drive destination', async () => {
  const ws = await workspace('free');

  const response = await connectGdrive(ws);

  expect(response.status).toBe(422);
  expect(await errorCode(response)).toBe('validation_failed');
  expect(await prisma.storageConnection.count()).toBe(0);
});

test('a Pro workspace cannot connect an S3 destination', async () => {
  const ws = await workspace('pro');

  const response = await connectS3(ws);

  expect(response.status).toBe(422);
  expect(await prisma.storageConnection.count()).toBe(0);
});

test('a Pro workspace can connect a Drive destination; the secret is never echoed back', async () => {
  const ws = await workspace('pro');

  const response = await connectGdrive(ws);

  expect(response.status).toBe(200);
  const body = (await response.json()) as { kind: string; status: string; config: { folderId: string } };
  expect(body.kind).toBe('gdrive');
  expect(body.status).toBe('untested');
  expect(body.config).toEqual({ folderId: 'folder-123' });
  expect(JSON.stringify(body)).not.toContain('refresh-token-abc');

  const stored = await prisma.storageConnection.findUniqueOrThrow({
    where: { organizationId_kind: { organizationId: ws.organizationId, kind: 'gdrive' } },
  });
  expect(stored.secret).not.toContain('refresh-token-abc');
});

test('an Enterprise workspace can connect an S3 destination', async () => {
  const ws = await workspace('enterprise');

  const response = await connectS3(ws);

  expect(response.status).toBe(200);
  const body = (await response.json()) as { kind: string };
  expect(body.kind).toBe('s3');
});

test('testing a connection that round-trips successfully marks it connected', async () => {
  const ws = await workspace('pro', () => fakeProvider('drive'));
  await connectGdrive(ws);

  const response = await post(ws, '/api/v1/storage/connections/gdrive/test');

  expect(response.status).toBe(200);
  const body = (await response.json()) as { status: string; last_tested_at: string | null };
  expect(body.status).toBe('connected');
  expect(body.last_tested_at).not.toBeNull();
});

test('testing a connection whose provider fails marks it failed, never connected', async () => {
  const failing = fakeProvider('drive', {
    upload: () => Promise.reject(new Error('storage is down')),
  });
  const ws = await workspace('pro', () => failing);
  await connectGdrive(ws);

  const response = await post(ws, '/api/v1/storage/connections/gdrive/test');

  expect(response.status).toBe(502);
  expect(await errorCode(response)).toBe('upload_failed');

  const stored = await prisma.storageConnection.findUniqueOrThrow({
    where: { organizationId_kind: { organizationId: ws.organizationId, kind: 'gdrive' } },
  });
  expect(stored.status).toBe('failed');
});

test('testing an unknown kind returns 404', async () => {
  const ws = await workspace('pro');

  const response = await post(ws, '/api/v1/storage/connections/gdrive/test');

  expect(response.status).toBe(404);
});

test('activating requires a connection that has passed a test', async () => {
  const ws = await workspace('pro');
  await connectGdrive(ws);

  const response = await post(ws, '/api/v1/storage/connections/gdrive/activate');

  expect(response.status).toBe(422);
  const site = await prisma.workspaceSite.findUnique({ where: { organizationId: ws.organizationId } });
  expect(site?.storageKind ?? null).toBeNull();
});

test('activating a connected connection sets WorkspaceSite.storageKind', async () => {
  const ws = await workspace('pro', () => fakeProvider('drive'));
  await connectGdrive(ws);
  await post(ws, '/api/v1/storage/connections/gdrive/test');

  const response = await post(ws, '/api/v1/storage/connections/gdrive/activate');

  expect(response.status).toBe(200);
  const site = await prisma.workspaceSite.findUniqueOrThrow({ where: { organizationId: ws.organizationId } });
  expect(site.storageKind).toBe('gdrive');

  const overview = (await (await get(ws, '/api/v1/storage')).json()) as { active_kind: string | null };
  expect(overview.active_kind).toBe('gdrive');
});

test('disconnecting removes the connection and clears an active storageKind', async () => {
  const ws = await workspace('pro', () => fakeProvider('drive'));
  await connectGdrive(ws);
  await post(ws, '/api/v1/storage/connections/gdrive/test');
  await post(ws, '/api/v1/storage/connections/gdrive/activate');

  const response = await del(ws, '/api/v1/storage/connections/gdrive');

  expect(response.status).toBe(200);
  expect(await prisma.storageConnection.count()).toBe(0);
  const site = await prisma.workspaceSite.findUniqueOrThrow({ where: { organizationId: ws.organizationId } });
  expect(site.storageKind).toBeNull();
});

test('disconnecting a kind with no connection returns 404', async () => {
  const ws = await workspace('pro');

  const response = await del(ws, '/api/v1/storage/connections/gdrive');

  expect(response.status).toBe(404);
});

test('an editor cannot connect, test, activate or disconnect storage', async () => {
  const ws = await workspace('pro');
  await prisma.member.updateMany({ where: { organizationId: ws.organizationId }, data: { role: 'editor' } });

  expect((await connectGdrive(ws)).status).toBe(403);
  expect((await post(ws, '/api/v1/storage/connections/gdrive/test')).status).toBe(403);
  expect((await post(ws, '/api/v1/storage/connections/gdrive/activate')).status).toBe(403);
  expect((await del(ws, '/api/v1/storage/connections/gdrive')).status).toBe(403);
});

test('GET /api/v1/storage requires a session or API key', async () => {
  const ws = await workspace('pro');

  const response = await ws.app.handle(new Request(`${BASE_URL}/api/v1/storage`));

  expect(response.status).toBe(401);
});

test('reconnecting a kind replaces the stored config and resets status to untested', async () => {
  const ws = await workspace('pro', () => fakeProvider('drive'));
  await connectGdrive(ws);
  await post(ws, '/api/v1/storage/connections/gdrive/test');

  const response = await post(ws, '/api/v1/storage/connections', {
    kind: 'gdrive',
    folder_id: 'a-different-folder',
    refresh_token: 'a-different-token',
  });

  expect(response.status).toBe(200);
  const body = (await response.json()) as { status: string; config: { folderId: string } };
  expect(body.status).toBe('untested');
  expect(body.config).toEqual({ folderId: 'a-different-folder' });
});
