import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { BASE_URL, cleanDatabase, memoryStorage, realFetch, signIn, type App } from '../../test/helpers';
import { tinyPng, tinyWebp } from '../../test/images';
import { getPrisma } from '../db';
import { createApp } from '../index';
import type { Storage } from '../storage/provider';

const prisma = getPrisma();

/** Hosts that must never reach a client: the publicId is the only thing we expose. */
const PROVIDER_HOSTS = ['drive.google.com', 'googleusercontent.com'] as const;

type Fixture = {
  app: App;
  /** Uploads an image through the real POST route and returns its publicId. */
  upload: (bytes: Uint8Array<ArrayBuffer>, contentType?: string) => Promise<string>;
  get: (path: string) => Promise<Response>;
};

const setup = async (storage?: Storage): Promise<Fixture> => {
  const app = createApp(async () => {}, storage ?? memoryStorage());
  const cookie = await signIn(app);

  const upload: Fixture['upload'] = async (bytes, contentType = 'image/png') => {
    const response = await app.handle(
      new Request(`${BASE_URL}/api/v1/assets`, {
        method: 'POST',
        headers: { cookie, 'content-type': contentType, 'x-opendocs-kind': 'step' },
        body: bytes,
      }),
    );
    expect(response.status).toBe(201);
    return ((await response.json()) as { id: string }).id;
  };

  return { app, upload, get: (path) => app.handle(new Request(`${BASE_URL}${path}`)) };
};

const errorCode = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

beforeEach(async () => {
  await cleanDatabase();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  await cleanDatabase();
});

test('sets nosniff, sandbox CSP and public immutable cache headers', async () => {
  const { upload, get } = await setup();
  const bytes = tinyPng();
  const id = await upload(bytes);

  const response = await get(`/api/i/${id}`);

  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/png');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('content-security-policy')).toBe('sandbox');
  expect(response.headers.get('cache-control')).toBe('public, immutable, max-age=3600');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
});

test('TTL asset max-age capped at remaining TTL', async () => {
  const { upload, get } = await setup();
  const id = await upload(tinyPng());
  await prisma.asset.update({
    where: { publicId: id },
    data: { expiresAt: new Date(Date.now() + 30_000) },
  });

  const response = await get(`/api/i/${id}`);

  expect(response.status).toBe(200);
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1]);
  expect(maxAge).toBeGreaterThanOrEqual(28);
  expect(maxAge).toBeLessThanOrEqual(30);
});

test('never leaks a drive.google.com/googleusercontent.com URL', async () => {
  const { upload, get } = await setup();
  const id = await upload(tinyPng());

  const response = await get(`/api/i/${id}`);

  expect(response.status).toBe(200);
  // A redirect would hand the storage URL straight to the client.
  expect(response.redirected).toBe(false);
  expect(response.headers.get('location')).toBeNull();

  const headers = [...response.headers.entries()].map(([name, value]) => `${name}: ${value}`).join('\n');
  // Bytes decoded as latin1 so any ASCII host string inside the payload still matches.
  const body = Buffer.from(await response.arrayBuffer()).toString('latin1');
  for (const host of PROVIDER_HOSTS) {
    expect(headers).not.toContain(host);
    expect(body).not.toContain(host);
  }
});

test('ignores a spoofed file extension', async () => {
  const { upload, get } = await setup();
  const id = await upload(tinyWebp(), 'image/webp');

  const response = await get(`/api/i/${id}.svg`);

  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/webp');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('content-security-policy')).toBe('sandbox');
});

test('returns 410 for an expired asset before the TTL job runs', async () => {
  const { upload, get } = await setup();
  const id = await upload(tinyPng());
  await prisma.asset.update({
    where: { publicId: id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });

  const response = await get(`/api/i/${id}`);

  expect(response.status).toBe(410);
  expect(await errorCode(response)).toBe('gone');
  // The row is still there: nothing swept it, the route decided on read.
  expect(await prisma.asset.count({ where: { publicId: id } })).toBe(1);
});

test('returns 410 for a deletedAt asset', async () => {
  const { upload, get } = await setup();
  const id = await upload(tinyPng());
  await prisma.asset.update({ where: { publicId: id }, data: { deletedAt: new Date() } });

  const response = await get(`/api/i/${id}`);

  expect(response.status).toBe(410);
  expect(await errorCode(response)).toBe('gone');
});

test('returns 404 for an unknown publicId', async () => {
  const { get } = await setup();

  const response = await get('/api/i/aaaaaaaaaaaaaaaa');

  expect(response.status).toBe(404);
  expect(await errorCode(response)).toBe('not_found');
  expect(response.headers.get('cache-control')).toBe('no-store');
});

test('410 responses are not cached', async () => {
  const { upload, get } = await setup();
  const id = await upload(tinyPng());
  await prisma.asset.update({
    where: { publicId: id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });

  const response = await get(`/api/i/${id}`);

  expect(response.status).toBe(410);
  expect(response.headers.get('cache-control')).toBe('no-store');
});

test('storage read failure returns 500 no-store', async () => {
  const base = memoryStorage();
  const failing: Storage = { ...base, read: () => Promise.reject(new Error('storage unavailable')) };

  const { upload, get } = await setup(failing);
  const id = await upload(tinyPng());

  const response = await get(`/api/i/${id}`);

  expect(response.status).toBe(500);
  expect(await errorCode(response)).toBe('internal_error');
  expect(response.headers.get('cache-control')).toBe('no-store');
});
