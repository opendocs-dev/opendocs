import { MAX_BYTES, SNAP_TTL } from '@opendocs/core';
import { AssetUploadResponseSchema } from '@opendocs/core';
import { Value } from '@sinclair/typebox/value';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { BASE_URL, cleanDatabase, memoryStorage, realFetch, signIn, type App } from '../../test/helpers';
import { pngOfExactSize, pngWithDimensions, svgBytes, tinyPng, tinyWebp } from '../../test/images';
import { getPrisma } from '../db';
import { resetEnvForTest } from '../env';
import { newPublicId } from '../ids';
import { createApp } from '../index';

const prisma = getPrisma();

/** A step-image cap used by the storage quota tests (1 GB). */
const QUOTA_BYTES = 1_000_000_000;

const storedFiles = (storage: ReturnType<typeof memoryStorage>): string[] => [...storage.objects.keys()];

const ENV_KEYS = ['ASSET_BASE_URL', 'S3_PREFIX', 'STORAGE_QUOTA_BYTES', 'MAX_UPLOAD_BYTES'] as const;
const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]));

/** Sets env overrides for one test; `afterEach` restores them. */
const withEnv = (overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>) => {
  for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
  resetEnvForTest();
};

type Upload = {
  app: App;
  cookie: string;
  storage: ReturnType<typeof memoryStorage>;
  organizationId: string;
  post: (init: {
    body?: BodyInit | null;
    headers?: Record<string, string>;
  }) => Promise<Response>;
};

const setup = async (): Promise<Upload> => {
  const storage = memoryStorage();
  const app = createApp(async () => {}, storage);
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();

  const post: Upload['post'] = ({ body, headers }) =>
    app.handle(
      new Request(`${BASE_URL}/api/v1/assets`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'image/png', ...headers },
        body: body ?? null,
      }),
    );

  return { app, cookie, storage, organizationId: organization.id, post };
};

/** Seeds an existing live step Asset row of exactly `bytes`, without touching storage. */
const seedStepAsset = (organizationId: string, bytes: number) =>
  prisma.asset.create({
    data: {
      publicId: newPublicId(),
      organizationId,
      kind: 'step',
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
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvForTest();
});

afterAll(async () => {
  await cleanDatabase();
});

test('step upload expires in 7 days', async () => {
  const { post, storage } = await setup();
  const bytes = tinyPng();

  const before = Date.now();
  const response = await post({ body: bytes, headers: { 'x-opendocs-kind': 'step' } });

  expect(response.status).toBe(201);
  const body = (await response.json()) as { id: string; url: string; expires_at: string };
  expect(Value.Check(AssetUploadResponseSchema, body)).toBe(true);
  expect(body.id).toMatch(/^[0-9A-Za-z]{16}$/);
  expect(body.url).toBe(`${BASE_URL}/api/i/${body.id}`);

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
  expect(asset.sha256).toHaveLength(64);

  expect(await storedFiles(storage)).toEqual([asset.providerFileId]);
  expect(storage.objects.get(asset.providerFileId)).toEqual(bytes);
});

test('brand upload (favicon/share image) never expires', async () => {
  const { post, storage } = await setup();
  const bytes = tinyPng();

  const response = await post({ body: bytes, headers: { 'x-opendocs-kind': 'brand' } });

  expect(response.status).toBe(201);
  const body = (await response.json()) as { id: string; url: string; expires_at: string | null };
  expect(Value.Check(AssetUploadResponseSchema, body)).toBe(true);
  expect(body.expires_at).toBeNull();

  const asset = await prisma.asset.findUniqueOrThrow({ where: { publicId: body.id } });
  expect(asset.kind).toBe('brand');
  expect(asset.expiresAt).toBeNull();

  expect(await storedFiles(storage)).toEqual([asset.providerFileId]);
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
  withEnv({ STORAGE_QUOTA_BYTES: String(QUOTA_BYTES) });
  const { post, organizationId } = await setup();
  await seedStepAsset(organizationId, QUOTA_BYTES - 1_000_000);

  const response = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'step' } });

  expect(response.status).toBe(201);
});

test('over quota returns 403 storage_quota_exceeded and stores nothing', async () => {
  withEnv({ STORAGE_QUOTA_BYTES: String(QUOTA_BYTES) });
  const { post, storage, organizationId } = await setup();
  await seedStepAsset(organizationId, QUOTA_BYTES);
  const before = await prisma.asset.count();

  const response = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'step' } });

  expect(response.status).toBe(403);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
    'storage_quota_exceeded',
  );
  expect(await prisma.asset.count()).toBe(before);
  expect(await storedFiles(storage)).toEqual([]);
});

test('exactly at the limit is allowed', async () => {
  withEnv({ STORAGE_QUOTA_BYTES: String(QUOTA_BYTES) });
  const { post, organizationId } = await setup();
  const bytes = tinyPng();
  await seedStepAsset(organizationId, QUOTA_BYTES - bytes.byteLength);

  const response = await post({ body: bytes, headers: { 'x-opendocs-kind': 'step' } });

  expect(response.status).toBe(201);
});

test('deleting a doc frees the quota', async () => {
  withEnv({ STORAGE_QUOTA_BYTES: String(QUOTA_BYTES) });
  const { app, cookie, post, organizationId } = await setup();
  const seeded = await seedStepAsset(organizationId, QUOTA_BYTES - 10);

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
  withEnv({ STORAGE_QUOTA_BYTES: String(QUOTA_BYTES) });
  const { post, organizationId } = await setup();
  await seedStepAsset(organizationId, QUOTA_BYTES);

  const response = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'snap' } });

  expect(response.status).toBe(201);
});

test('brand uploads ignore the storage quota', async () => {
  withEnv({ STORAGE_QUOTA_BYTES: String(QUOTA_BYTES) });
  const { post, organizationId } = await setup();
  await seedStepAsset(organizationId, QUOTA_BYTES);

  const response = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'brand' } });

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
  const { post, storage } = await setup();

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
  expect(await storedFiles(storage)).toEqual([]);
});

test('rejects content-length over 10MB before reading body', async () => {
  const { post, storage } = await setup();

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
  expect(await storedFiles(storage)).toEqual([]);
});

test('aborts with 413 when actual bytes exceed 10MB despite a smaller header', async () => {
  const { post, storage } = await setup();

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
  expect(await storedFiles(storage)).toEqual([]);
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
  const { post, storage } = await setup();

  const response = await post({
    body: svgBytes(),
    headers: { 'x-opendocs-kind': 'step', 'content-type': 'image/svg+xml' },
  });

  expect(response.status).toBe(415);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
    'unsupported_media_type',
  );
  expect(await prisma.asset.count()).toBe(0);
  expect(await storedFiles(storage)).toEqual([]);
});

test('rejects a PNG lying about 1M x 1M pixels with 422', async () => {
  const { post, storage } = await setup();

  const response = await post({
    body: pngWithDimensions(1_000_000, 1_000_000),
    headers: { 'x-opendocs-kind': 'step' },
  });

  expect(response.status).toBe(422);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
    'image_too_many_pixels',
  );
  expect(await prisma.asset.count()).toBe(0);
  expect(await storedFiles(storage)).toEqual([]);
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
  const { post, storage } = await setup();

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
  expect(await storedFiles(storage)).toEqual([]);
});

test('accepts a WebP identified by its RIFF/WEBP magic bytes', async () => {
  const { post } = await setup();
  const response = await post({ body: tinyWebp(), headers: { 'content-type': 'image/webp', 'x-opendocs-kind': 'step' } });
  expect(response.status).toBe(201);
  const asset = await prisma.asset.findFirstOrThrow();
  expect(asset.mime).toBe('image/webp');
});

test('rejects a RIFF file that is not WEBP with 415', async () => {
  const { post, storage } = await setup();
  const wave = new Uint8Array(64);
  wave.set(new TextEncoder().encode('RIFF'), 0);
  wave.set(new TextEncoder().encode('WAVE'), 8);
  const response = await post({ body: wave, headers: { 'x-opendocs-kind': 'step' } });
  expect(response.status).toBe(415);
  expect(await storedFiles(storage)).toHaveLength(0);
});

test('a failed database write deletes the stored file', async () => {
  const { post, storage } = await setup();
  const originalCreate = prisma.asset.create;
  (prisma.asset as { create: unknown }).create = () => {
    throw new Error('database down');
  };
  try {
    const response = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'step' } });
    expect(response.status).toBe(500);
  } finally {
    (prisma.asset as { create: unknown }).create = originalCreate;
  }
  expect(storedFiles(storage)).toHaveLength(0);
  expect(await prisma.asset.count()).toBe(0);
});

test('with no STORAGE_QUOTA_BYTES (0) there is no cap on step uploads', async () => {
  const { post, organizationId } = await setup();
  await seedStepAsset(organizationId, QUOTA_BYTES * 2);

  const response = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'step' } });

  expect(response.status).toBe(201);
});

test('STORAGE_QUOTA_BYTES refuses an over-cap step upload with 403 and stores nothing', async () => {
  withEnv({ STORAGE_QUOTA_BYTES: '1000' });
  const { post, storage, organizationId } = await setup();
  await seedStepAsset(organizationId, 1000);

  const response = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'step' } });

  expect(response.status).toBe(403);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
    'storage_quota_exceeded',
  );
  expect(storedFiles(storage)).toEqual([]);
});

test('MAX_UPLOAD_BYTES override gives 413 above it and accepts exactly it', async () => {
  const bytes = tinyPng();
  withEnv({ MAX_UPLOAD_BYTES: String(bytes.byteLength) });
  const { post, storage } = await setup();

  const ok = await post({ body: bytes, headers: { 'x-opendocs-kind': 'step' } });
  expect(ok.status).toBe(201);

  const bigger = new Uint8Array(bytes.byteLength + 1);
  bigger.set(bytes);
  const refused = await post({ body: bigger, headers: { 'x-opendocs-kind': 'step' } });
  expect(refused.status).toBe(413);
  expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('payload_too_large');
  expect(storedFiles(storage)).toHaveLength(1);
});

test('ASSET_BASE_URL makes the upload url point at the prefixed object key', async () => {
  withEnv({ ASSET_BASE_URL: 'https://cdn.example.com/media', S3_PREFIX: 'docs' });
  const { post } = await setup();

  const response = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'step' } });

  expect(response.status).toBe(201);
  const body = (await response.json()) as { id: string; url: string };
  const asset = await prisma.asset.findUniqueOrThrow({ where: { publicId: body.id } });
  expect(body.url).toBe(`https://cdn.example.com/media/docs/${asset.providerFileId}`);
});

test('the stored object key is providerFileId', async () => {
  const { post, storage } = await setup();
  const bytes = tinyPng();

  const response = await post({ body: bytes, headers: { 'x-opendocs-kind': 'step' } });
  const body = (await response.json()) as { id: string };
  const asset = await prisma.asset.findUniqueOrThrow({ where: { publicId: body.id } });

  expect(storage.objects.has(asset.providerFileId)).toBe(true);
  expect(await storage.read(asset.providerFileId)).toEqual(bytes);
});
