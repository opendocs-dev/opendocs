import { afterEach, describe, expect, test } from 'bun:test';

import { GET } from './route';

const realFetch = globalThis.fetch;
let responses: Record<string, unknown> = {};

function stubFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [match, body] of Object.entries(responses)) {
      if (url.includes(match)) {
        return new Response(JSON.stringify(body), { status: 200 });
      }
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  responses = {};
});

const request = (host = 'acme.opendocs.test') =>
  new Request(`https://${host}/sitemap.xml`, { headers: { host } });

describe('GET /sitemap.xml (C16 AC-12)', () => {
  test('404s for an unknown or suspended tenant, the same as every other public route', async () => {
    responses = {}; // getSiteInfo misses
    stubFetch();

    await expect(
      GET(request(), { params: Promise.resolve({ slug: 'ghost' }) }),
    ).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });

  test('lists published guide URLs for an active tenant with indexing on', async () => {
    responses = {
      '/site/acme/info': { title: 'Acme', tagline: '', preset: 'sage', indexing: true, is_free_plan: false, guides: 1 },
      '/site/acme/guides': {
        guides: [{ slug: 'first-guide', title: 'First', summary: '', updated_at: '2026-01-01T00:00:00Z', steps: 1, category: null }],
        total: 1,
      },
      '/site/acme/categories': { categories: [] },
    };
    stubFetch();

    const response = await GET(request(), { params: Promise.resolve({ slug: 'acme' }) });
    const xml = await response.text();

    expect(response.headers.get('content-type')).toBe('application/xml');
    expect(xml).toContain('/g/first-guide');
  });

  test('is empty of guide and category urls when indexing is off (D11)', async () => {
    responses = {
      '/site/acme/info': { title: 'Acme', tagline: '', preset: 'sage', indexing: false, is_free_plan: false, guides: 1 },
      '/site/acme/guides': {
        guides: [{ slug: 'first-guide', title: 'First', summary: '', updated_at: '2026-01-01T00:00:00Z', steps: 1, category: null }],
        total: 1,
      },
      '/site/acme/categories': { categories: [] },
    };
    stubFetch();

    const response = await GET(request(), { params: Promise.resolve({ slug: 'acme' }) });
    const xml = await response.text();

    expect(xml).not.toContain('/g/first-guide');
  });
});
