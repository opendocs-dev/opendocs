import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

const realFetch = globalThis.fetch;
let responses: Record<string, unknown> = {};

mock.module('next/headers', () => ({
  headers: async () => ({ get: (key: string) => (key === 'host' ? 'acme.opendocs.test' : null) }),
}));

// Dynamic import so next/headers is mocked before `./page` (and its
// transitive site-api import) resolve the real module.
const SiteCategoryPage = (await import('./page')).default;

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

const params = Promise.resolve({ category: 'billing' });
const searchParams = Promise.resolve({});

describe('SiteCategoryPage (C17 AC-13)', () => {
  test('lists the guides filed under an active category', async () => {
    responses = {
      '/site/categories': {
        categories: [{ slug: 'billing', name: 'Billing', description: 'Billing guides', guides: 1 }],
      },
      '/site/guides': {
        guides: [
          { slug: 'invoice-guide', title: 'Create an invoice', summary: '', updated_at: '2026-01-01T00:00:00Z', steps: 2, category: { slug: 'billing', name: 'Billing' } },
        ],
        total: 1,
      },
    };
    stubFetch();

    const element = await SiteCategoryPage({ params, searchParams });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Billing');
    expect(html).toContain('Create an invoice');
    expect(html).toContain('href="/g/invoice-guide"');
  });

  test('404s for a category slug that does not exist', async () => {
    responses = {
      '/site/categories': { categories: [] },
    };
    stubFetch();

    await expect(
      SiteCategoryPage({ params: Promise.resolve({ category: 'unknown' }), searchParams }),
    ).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });

  test('404s for a suggested (not yet accepted) category, same as unknown (D4)', async () => {
    responses = {
      '/site/categories': {
        // The public endpoint only ever returns active categories (D4), so a
        // suggested slug behaves identically to one the API never returns.
        categories: [],
      },
    };
    stubFetch();

    await expect(
      SiteCategoryPage({ params: Promise.resolve({ category: 'suggested-slug' }), searchParams }),
    ).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });
});
