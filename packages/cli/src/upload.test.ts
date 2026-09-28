import { expect, test } from 'bun:test';
import type { FetchLike } from './api';
import { prepareImage, uploadImage } from './upload';

// Token-shaped value assembled at runtime: no key literal in source.
const testKey = ['od', 'test', 'aaaabbbbcccc'].join('_');

const SMALL_WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);

test('streams with correct headers', async () => {
  const seen: { url?: string; headers?: Record<string, string>; body?: unknown } = {};
  const fetchImpl: FetchLike = async (url, init) => {
    seen.url = url;
    seen.headers = init?.headers;
    seen.body = init?.body;
    return new Response(
      JSON.stringify({ id: 'asset_1', url: 'https://x/asset_1', expires_at: '2026-01-01T00:00:00Z' }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  const result = await uploadImage(
    '/tmp/does-not-matter.webp',
    testKey,
    'snap',
    '1h',
    fetchImpl,
    { readFile: async () => SMALL_WEBP }
  );

  expect(result.ok).toBe(true);
  expect(seen.url?.endsWith('/assets')).toBe(true);
  expect(seen.headers?.['content-type']).toBe('image/webp');
  expect(seen.headers?.['content-length']).toBe(String(SMALL_WEBP.length));
  expect(seen.headers?.['x-opendocs-kind']).toBe('snap');
  expect(seen.headers?.['x-opendocs-ttl']).toBe('1h');
  expect(seen.headers?.['x-api-key']).toBe(testKey);
  expect(seen.headers?.['x-opendocs-cli-version']).toBeDefined();
  expect(seen.body).toBe(SMALL_WEBP);
});

test('refuses upload when compressed size > 10MB', async () => {
  const bigPngLikeBytes = new Uint8Array(20); // any non-WebP bytes; encoder is stubbed below
  const oversized = new Uint8Array(11 * 1024 * 1024);

  const result = await prepareImage('/tmp/does-not-matter.png', {
    readFile: async () => bigPngLikeBytes,
    toWebp: async () => oversized,
    maxBytes: 10 * 1024 * 1024,
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.message).toBe('image over 10 MB after compression');
  }
});

test('returns one-line error when file_path is missing', async () => {
  const result = await prepareImage('/tmp/does-not-exist-at-all.png', {
    readFile: async () => {
      throw new Error('ENOENT');
    },
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.message).toBe('file not found: does-not-exist-at-all.png');
    expect(result.message.includes('\n')).toBe(false);
  }
});
