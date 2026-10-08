import { MAX_BYTES, SNAP_TTL } from '@opendocs/core';
import { FREE_STORAGE_BYTES } from '../legacy-limits';
import { AssetUploadResponseSchema } from '@opendocs/core';
import { Value } from '@sinclair/typebox/value';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { BASE_URL, cleanDatabase, realFetch, signIn, type App } from '../../test/helpers';
import { pngOfExactSize, pngWithDimensions, svgBytes, tinyPng, tinyWebp } from '../../test/images';
import { getPrisma } from '../db';
import { newPublicId } from '../ids';
import { createApp } from '../index';
import { LocalDiskProvider } from '../storage/local';
import { getStorage, type Storage } from '../storage/provider';

const prisma = getPrisma();

/** A fresh temp dir per app keeps stored files isolated from other test files. */
const localStorage = async (): Promise<Storage & { root: string }> => {
  const root = await mkdtemp(join(tmpdir(), 'od-assets-'));
  return { root, provider: new LocalDiskProvider(root), accounts: ['local'] };
};

/** Counts every file the provider has actually written, across accounts. */
const storedFiles = async (root: string): Promise<string[]> => {
  const accounts = await readdir(root).catch(() => [] as string[]);
  const names: string[] = [];
  for (const account of accounts) {
    names.push(...(await readdir(join(root, account)).catch(() => [] as string[])));
  }
  return names;
};

type Upload = {
  app: App;
  cookie: string;
  root: string;
  organizationId: string;
  post: (init: {
    body?: BodyInit | null;
    headers?: Record<string, string>;
  }) => Promise<Response>;
};

const setup = async (storage?: Storage & { root: string }): Promise<Upload> => {
  const resolved = storage ?? (await localStorage());
  const app = createApp(async () => {}, resolved);
  const cookie = await signIn(app);

  const session = await prisma.session.findFirstOrThrow({
    where: { activeOrganizationId: { not: null } },
    orderBy: { createdAt: 'desc' },
  });

  const post: Upload['post'] = ({ body, headers }) =>
    app.handle(
      new Request(`${BASE_URL}/api/v1/assets`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'image/png', ...headers },
        body: body ?? null,
      }),
    );

  return { app, cookie, root: resolved.root, organizationId: session.activeOrganizationId!, post };
};

/** Seeds an existing live step Asset row of exactly `bytes`, without touching storage. */
const seedStepAsset = (organizationId: string, bytes: number) =>
  prisma.asset.create({
    data: {
      publicId: newPublicId(),
      organizationId,
      kind: 'step',
      provider: 'local',
      providerAccount: 'local',
      providerFileId: newPublicId(),
      mime: 'image/png',
      bytes,
      width: 4,
      height: 4,
      sha256: 'a'.repeat(64),
      expiresAt: null,
    },
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

test('step upload expires in 7 days', async () => {
  const { post, root } = await setup();
  const bytes = tinyPng();

  const before = Date.now();
  const response = await post({ body: bytes, headers: { 'x-opendocs-kind': 'step' } });

  expect(response.status).toBe(201);
  const body = (await response.json()) as { id: string; url: string; expires_at: string };
  expect(Value.Check(AssetUploadResponseSchema, body)).toBe(true);
  expect(body.id).toMatch(/^[0-9A-Za-z]{16}$/);
  expect(body.url).toBe(`${process.env.ASSET_BASE_URL}/i/${body.id}`);

  // A step image is a draft until its run is compiled: it expires in 7 days.
  const expires = new Date(body.expires_at).getTime();
  expect(expires - before).toBeGreaterThan(6 * 86_400_000);
  expect(expires - before).toBeLessThan(8 * 86_400_000);

  const asset = await prisma.asset.findUniqueOrThrow({ where: { publicId: body.id } });
  expect(asset.kind).toBe('step');
  expect(asset.mime).toBe('image/png');
  expect(asset.bytes).toBe(bytes.byteLength);
  expect(asset.width).toBe(4);
  expect(asset.height).toBe(4);
  expect(asset.provider).toBe('local');
  expect(asset.providerAccount).toBe('local');
  expect(asset.sha256).toHaveLength(64);

  expect(await storedFiles(root)).toEqual([asset.providerFileId]);

  const usage = await prisma.usageDaily.findFirstOrThrow();
  expect(usage.files).toBe(1);
  expect(usage.bytes).toBe(BigInt(bytes.byteLength));
});

test('brand upload (favicon/share image) never expires', async () => {
  const { post, root } = await setup();
  const bytes = tinyPng();

  const response = await post({ body: bytes, headers: { 'x-opendocs-kind': 'brand' } });

  expect(response.status).toBe(201);
  const body = (await response.json()) as { id: string; url: string; expires_at: string | null };
  expect(Value.Check(AssetUploadResponseSchema, body)).toBe(true);
  expect(body.expires_at).toBeNull();

  const asset = await prisma.asset.findUniqueOrThrow({ where: { publicId: body.id } });
  expect(asset.kind).toBe('brand');
  expect(asset.expiresAt).toBeNull();

  expect(await storedFiles(root)).toEqual([asset.providerFileId]);
});

test('snap expires_at follows the ttl header, default 24h', async () => {
  const { post } = await setup();

  const expiryAfter = async (headers: Record<string, string>) => {
    const before = Date.now();
    const response = await post({ body: tinyPng(), headers });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { expires_at: string };
    return new Date(body.expires_at).getTime() - before;
  };

  const tolerance = 5_000;
  const quarterHour = await expiryAfter({ 'x-opendocs-kind': 'snap', 'x-opendocs-ttl': '15m' });
  expect(Math.abs(quarterHour - SNAP_TTL.seconds['15m'] * 1000)).toBeLessThan(tolerance);

  const hour = await expiryAfter({ 'x-opendocs-kind': 'snap', 'x-opendocs-ttl': '1h' });
  expect(Math.abs(hour - SNAP_TTL.seconds['1h'] * 1000)).toBeLessThan(tolerance);

  const day = await expiryAfter({ 'x-opendocs-kind': 'snap' });
  expect(Math.abs(day - SNAP_TTL.seconds['24h'] * 1000)).toBeLessThan(tolerance);

  // An unknown TTL never reaches storage.
  const rejected = await post({
    body: tinyPng(),
    headers: { 'x-opendocs-kind': 'snap', 'x-opendocs-ttl': '7d' },
  });
  expect(rejected.status).toBe(422);
  expect(((await rejected.json()) as { error: { code: string } }).error.code).toBe(
    'validation_failed',
  );
});

test('step upload under quota succeeds', async () => {
  const { post, organizationId } = await setup();
  await seedStepAsset(organizationId, FREE_STORAGE_BYTES - 1_000_000);

  const response = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'step' } });

  expect(response.status).toBe(201);
});

test('over quota returns 403 storage_quota_exceeded and stores nothing', async () => {
  const { post, root, organizationId } = await setup();
  await seedStepAsset(organizationId, FREE_STORAGE_BYTES);
  const before = await prisma.asset.count();

  const response = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'step' } });

  expect(response.status).toBe(403);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
    'storage_quota_exceeded',
  );
  expect(await prisma.asset.count()).toBe(before);
  expect(await storedFiles(root)).toEqual([]);
});

test('exactly at the limit is allowed', async () => {
  const { post, organizationId } = await setup();
  const bytes = tinyPng();
  await seedStepAsset(organizationId, FREE_STORAGE_BYTES - bytes.byteLength);

  const response = await post({ body: bytes, headers: { 'x-opendocs-kind': 'step' } });

  expect(response.status).toBe(201);
});

test('deleting a doc frees the quota', async () => {
  const { app, cookie, post, organizationId } = await setup();
  const seeded = await seedStepAsset(organizationId, FREE_STORAGE_BYTES - 10);

  const refused = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'step' } });
  expect(refused.status).toBe(403);

  const flow = await prisma.flow.create({
    data: { publicId: newPublicId(), organizationId, title: 'Doc to delete' },
  });
  const run = await prisma.run.create({
    data: { publicId: newPublicId(), flowId: flow.id, status: 'compiled', compiledAt: new Date() },
  });
  await prisma.step.create({
    data: { runId: run.id, order: 1, action: 'click', instruction: 'Click', assetId: seeded.id },
  });

  const deletion = await app.handle(
    new Request(`${BASE_URL}/api/v1/flows/${flow.publicId}`, {
      method: 'DELETE',
      headers: { cookie },
    }),
  );
  expect(deletion.status).toBe(204);

  const allowed = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'step' } });
  expect(allowed.status).toBe(201);
});

test('snaps ignore the storage quota', async () => {
  const { post, organizationId } = await setup();
  await seedStepAsset(organizationId, FREE_STORAGE_BYTES);

  const response = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'snap' } });

  expect(response.status).toBe(201);
});

test('brand uploads ignore the storage quota', async () => {
  const { post, organizationId } = await setup();
  await seedStepAsset(organizationId, FREE_STORAGE_BYTES);

  const response = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'brand' } });

  expect(response.status).toBe(201);
});

test('a non-free plan has no storage cap', async () => {
  const { post, organizationId } = await setup();
  await prisma.workspaceBilling.create({ data: { organizationId, plan: 'pro' } });
  await seedStepAsset(organizationId, FREE_STORAGE_BYTES);

  const response = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'step' } });

  expect(response.status).toBe(201);
});

test('requires an API key or session', async () => {
  const { app } = await setup();

  const response = await app.handle(
    new Request(`${BASE_URL}/api/v1/assets`, {
      method: 'POST',
      headers: { 'content-type': 'image/png', 'x-opendocs-kind': 'step' },
      body: tinyPng(),
    }),
  );

  expect(response.status).toBe(401);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
  expect(await prisma.asset.count()).toBe(0);
});

test('rejects an unknown kind with 422', async () => {
  const { post } = await setup();

  const response = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'thumbnail' } });

  expect(response.status).toBe(422);
  expect(await prisma.asset.count()).toBe(0);
});

test('mid-stream disconnect leaves no Asset row and no orphaned Drive object', async () => {
  const { post, root } = await setup();

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(tinyPng());
      controller.error(new Error('client went away'));
    },
  });

  const response = await post({ body, headers: { 'x-opendocs-kind': 'step' } });

  // Documented behaviour: an aborted upload is reported as 400 validation_failed.
  expect(response.status).toBe(400);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
    'validation_failed',
  );
  expect(await prisma.asset.count()).toBe(0);
  expect(await prisma.usageDaily.count()).toBe(0);
  expect(await storedFiles(root)).toEqual([]);
});

test('rejects content-length over 10MB before reading body', async () => {
  const { post, root } = await setup();

  // A body that would throw if read: the 413 must come from the header alone.
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error('body must never be read'));
    },
  });

  const response = await post({
    body,
    headers: { 'x-opendocs-kind': 'step', 'content-length': String(MAX_BYTES + 1) },
  });

  expect(response.status).toBe(413);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
    'payload_too_large',
  );
  expect(await prisma.asset.count()).toBe(0);
  expect(await storedFiles(root)).toEqual([]);
});

test('aborts with 413 when actual bytes exceed 10MB despite a smaller header', async () => {
  const { post, root } = await setup();

  let cancelled = false;
  const chunk = new Uint8Array(1024 * 1024);
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      controller.enqueue(chunk.slice());
    },
    cancel() {
      cancelled = true;
    },
  });

  const response = await post({
    body,
    headers: { 'x-opendocs-kind': 'step', 'content-length': '1024' },
  });

  expect(response.status).toBe(413);
  expect(cancelled).toBe(true);
  expect(await prisma.asset.count()).toBe(0);
  expect(await storedFiles(root)).toEqual([]);
});

test('accepts a file at exactly 10MB', async () => {
  const { post } = await setup();
  const bytes = pngOfExactSize(MAX_BYTES);
  expect(bytes.byteLength).toBe(MAX_BYTES);

  const response = await post({ body: bytes, headers: { 'x-opendocs-kind': 'step' } });

  expect(response.status).toBe(201);
  const body = (await response.json()) as { id: string };
  const asset = await prisma.asset.findUniqueOrThrow({ where: { publicId: body.id } });
  expect(asset.bytes).toBe(MAX_BYTES);
});

test('rejects SVG with 415 before decoding', async () => {
  const { post, root } = await setup();

  const response = await post({
    body: svgBytes(),
    headers: { 'x-opendocs-kind': 'step', 'content-type': 'image/svg+xml' },
  });

  expect(response.status).toBe(415);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
    'unsupported_media_type',
  );
  expect(await prisma.asset.count()).toBe(0);
  expect(await storedFiles(root)).toEqual([]);
});

test('rejects a PNG lying about 1M x 1M pixels with 422', async () => {
  const { post, root } = await setup();

  const response = await post({
    body: pngWithDimensions(1_000_000, 1_000_000),
    headers: { 'x-opendocs-kind': 'step' },
  });

  expect(response.status).toBe(422);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
    'image_too_many_pixels',
  );
  expect(await prisma.asset.count()).toBe(0);
  expect(await storedFiles(root)).toEqual([]);
});

test('rejects a genuine 15k x 15k PNG with 422', async () => {
  const { post } = await setup();

  // 15000 * 15000 = 225 Mpx, over the 50 Mpx ceiling.
  const response = await post({
    body: pngWithDimensions(15_000, 15_000),
    headers: { 'x-opendocs-kind': 'step' },
  });

  expect(response.status).toBe(422);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
    'image_too_many_pixels',
  );
  expect(await prisma.asset.count()).toBe(0);
});

test('maps ERR_IMAGE_UNKNOWN_FORMAT to 415', async () => {
  const { post, root } = await setup();

  // Real PNG magic bytes, then garbage: sniffing passes, the decoder does not.
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
  ]);

  const response = await post({ body: bytes, headers: { 'x-opendocs-kind': 'step' } });

  expect(response.status).toBe(415);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
    'unsupported_media_type',
  );
  expect(await prisma.asset.count()).toBe(0);
  expect(await storedFiles(root)).toEqual([]);
});

test('accepts a WebP identified by its RIFF/WEBP magic bytes', async () => {
  const { post } = await setup();
  const response = await post({ body: tinyWebp(), headers: { 'content-type': 'image/webp', 'x-opendocs-kind': 'step' } });
  expect(response.status).toBe(201);
  const asset = await prisma.asset.findFirstOrThrow();
  expect(asset.mime).toBe('image/webp');
});

test('rejects a RIFF file that is not WEBP with 415', async () => {
  const { post, root } = await setup();
  const wave = new Uint8Array(64);
  wave.set(new TextEncoder().encode('RIFF'), 0);
  wave.set(new TextEncoder().encode('WAVE'), 8);
  const response = await post({ body: wave, headers: { 'x-opendocs-kind': 'step' } });
  expect(response.status).toBe(415);
  expect(await storedFiles(root)).toHaveLength(0);
});

test('a failed database write deletes the stored file', async () => {
  const { post, root } = await setup();
  // The session still names the workspace, so auth passes, but the Asset insert hits the FK.
  await prisma.organization.deleteMany();
  const response = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'step' } });
  expect(response.status).toBe(500);
  expect(await storedFiles(root)).toHaveLength(0);
  expect(await prisma.asset.count()).toBe(0);
});

/**
 * Exercises the real per-workspace routing decision (`resolveUploadProvider`): no
 * `storage` override, so Free must land on OpenDocs storage and a connected,
 * active `StorageConnection` must receive the bytes instead, for Pro/Enterprise.
 */
const setupRouted = async (storageConnectionProvider?: (connection: unknown) => Storage['provider']) => {
  const app = createApp(
    async () => {},
    undefined,
    storageConnectionProvider as Parameters<typeof createApp>[2],
  );
  const cookie = await signIn(app);
  const session = await prisma.session.findFirstOrThrow({
    where: { activeOrganizationId: { not: null } },
    orderBy: { createdAt: 'desc' },
  });
  const organizationId = session.activeOrganizationId!;
  const post = (init: { body?: BodyInit | null; headers?: Record<string, string> }) =>
    app.handle(
      new Request(`${BASE_URL}/api/v1/assets`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'image/png', ...init.headers },
        body: init.body ?? null,
      }),
    );
  return { app, cookie, organizationId, post };
};

test('Free workspace uploads go to OpenDocs storage even with a connected StorageConnection on file', async () => {
  const objects = new Map<string, Uint8Array>();
  const fakeDrive: Storage['provider'] = {
    name: 'drive',
    upload: async (_account, _key, bytes) => {
      const fileId = crypto.randomUUID();
      objects.set(fileId, bytes);
      return { fileId };
    },
    read: async (_account, fileId) => objects.get(fileId)!,
    delete: async (_account, fileId) => void objects.delete(fileId),
  };
  const { post, organizationId } = await setupRouted(() => fakeDrive);
  // A connected, active StorageConnection exists, but the workspace is still Free.
  await prisma.storageConnection.create({
    data: {
      organizationId,
      kind: 'gdrive',
      config: { folderId: 'folder-1' },
      secret: 'irrelevant-for-this-test',
      status: 'connected',
    },
  });
  await prisma.workspaceSite.create({
    data: { organizationId, siteTitle: 'Site', storageKind: 'gdrive' },
  });

  const response = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'step' } });

  expect(response.status).toBe(201);
  const body = (await response.json()) as { id: string };
  const asset = await prisma.asset.findUniqueOrThrow({ where: { publicId: body.id } });
  expect(asset.provider).toBe(getStorage().provider.name);
  expect(objects.size).toBe(0);
});

test('Pro workspace with an active connected StorageConnection uploads there, not to OpenDocs storage', async () => {
  const objects = new Map<string, Uint8Array>();
  const fakeDrive: Storage['provider'] = {
    name: 'drive',
    upload: async (_account, _key, bytes) => {
      const fileId = crypto.randomUUID();
      objects.set(fileId, bytes);
      return { fileId };
    },
    read: async (_account, fileId) => objects.get(fileId)!,
    delete: async (_account, fileId) => void objects.delete(fileId),
  };
  const { post, organizationId } = await setupRouted(() => fakeDrive);
  await prisma.workspaceBilling.create({ data: { organizationId, plan: 'pro' } });
  const connection = await prisma.storageConnection.create({
    data: {
      organizationId,
      kind: 'gdrive',
      config: { folderId: 'folder-1' },
      secret: 'irrelevant-for-this-test',
      status: 'connected',
    },
  });
  await prisma.workspaceSite.create({
    data: { organizationId, siteTitle: 'Site', storageKind: 'gdrive' },
  });
  const bytes = tinyPng();

  const response = await post({ body: bytes, headers: { 'x-opendocs-kind': 'step' } });

  expect(response.status).toBe(201);
  const body = (await response.json()) as { id: string };
  const asset = await prisma.asset.findUniqueOrThrow({ where: { publicId: body.id } });
  expect(asset.provider).toBe('drive');
  expect(asset.providerAccount).toBe(connection.id);
  expect(objects.size).toBe(1);
  expect(Array.from(objects.values())[0]).toEqual(bytes);
});

test('Pro workspace with no active StorageConnection falls back to OpenDocs storage, unchanged', async () => {
  const { post, organizationId } = await setupRouted();
  await prisma.workspaceBilling.create({ data: { organizationId, plan: 'pro' } });

  const response = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'step' } });

  expect(response.status).toBe(201);
  const body = (await response.json()) as { id: string };
  const asset = await prisma.asset.findUniqueOrThrow({ where: { publicId: body.id } });
  expect(asset.provider).toBe(getStorage().provider.name);
});

test('an active StorageConnection that is not connected (failed test) fails the upload instead of a silent fallback', async () => {
  const { post, organizationId } = await setupRouted();
  await prisma.workspaceBilling.create({ data: { organizationId, plan: 'pro' } });
  await prisma.storageConnection.create({
    data: {
      organizationId,
      kind: 'gdrive',
      config: { folderId: 'folder-1' },
      secret: 'irrelevant-for-this-test',
      status: 'failed',
    },
  });
  await prisma.workspaceSite.create({
    data: { organizationId, siteTitle: 'Site', storageKind: 'gdrive' },
  });
  const before = await prisma.asset.count();

  const response = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'step' } });

  // Never a silent fallback to OpenDocs storage: the broken connection fails the upload.
  expect(response.status).toBe(500);
  expect(await prisma.asset.count()).toBe(before);
});
