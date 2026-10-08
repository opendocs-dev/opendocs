import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getCategories, getGuide, getGuides, getSiteInfo, searchGuides } from './tenant-api';

const realFetch = globalThis.fetch;
let lastUrl: string | null = null;
let responses: { ok: boolean; body?: unknown } = { ok: true, body: {} };

beforeEach(() => {
  lastUrl = null;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    lastUrl = String(input);
    if (!responses.ok) return new Response('not found', { status: 404 });
    return Response.json(responses.body);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('getSiteInfo', () => {
  test('returns the parsed body on a 200', async () => {
    responses = { ok: true, body: { title: 'Acme', tagline: '', preset: 'sage', indexing: true, is_free_plan: true, guides: 2 } };
    const info = await getSiteInfo('acme');
    expect(info?.title).toBe('Acme');
    expect(lastUrl).toContain('/api/v1/site/acme/info');
  });

  test('returns null on a 404, never throws', async () => {
    responses = { ok: false };
    expect(await getSiteInfo('missing')).toBeNull();
  });
});

describe('getGuides', () => {
  test('sends limit and offset and returns null on a non-OK response', async () => {
    responses = { ok: false };
    expect(await getGuides('acme', 20, 20)).toBeNull();
    expect(lastUrl).toContain('/api/v1/site/acme/guides?limit=20&offset=20');
  });

  test('appends category parameter only when provided', async () => {
    responses = { ok: true, body: { guides: [], total: 0 } };
    await getGuides('acme', 20, 0, 'my-category');
    expect(lastUrl).toContain('category=my-category');
  });

  test('URL-encodes the category parameter', async () => {
    responses = { ok: true, body: { guides: [], total: 0 } };
    await getGuides('acme', 20, 0, 'a & b');
    expect(lastUrl).toContain('category=a+%26+b');
  });
});

describe('searchGuides', () => {
  test('encodes the query and returns null on a non-OK response', async () => {
    responses = { ok: false };
    expect(await searchGuides('acme', 'a & b')).toBeNull();
    expect(lastUrl).toContain('/api/v1/site/acme/search?q=a+%26+b');
  });

  test('appends category parameter only when provided', async () => {
    responses = { ok: true, body: { results: [], counts: [] } };
    await searchGuides('acme', 'test', 'my-category');
    expect(lastUrl).toContain('category=my-category');
  });

  test('URL-encodes the category parameter', async () => {
    responses = { ok: true, body: { results: [], counts: [] } };
    await searchGuides('acme', 'test', 'a & b');
    expect(lastUrl).toContain('category=a+%26+b');
  });
});

describe('getGuide', () => {
  test('returns null on a non-OK response', async () => {
    responses = { ok: false };
    expect(await getGuide('acme', 'unknown-slug')).toBeNull();
    expect(lastUrl).toContain('/api/v1/site/acme/guides/unknown-slug');
  });
});

describe('getCategories', () => {
  test('returns the parsed body on a 200', async () => {
    responses = { ok: true, body: { categories: [{ slug: 'getting-started', name: 'Getting Started', description: 'Learn the basics', guides: 5 }] } };
    const result = await getCategories('acme');
    expect(result?.categories).toHaveLength(1);
    expect(result?.categories[0]?.slug).toBe('getting-started');
    expect(lastUrl).toContain('/api/v1/site/acme/categories');
  });

  test('returns null on a 404, never throws', async () => {
    responses = { ok: false };
    expect(await getCategories('missing')).toBeNull();
  });
});
