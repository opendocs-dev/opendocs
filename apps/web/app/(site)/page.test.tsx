import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

const realFetch = globalThis.fetch;
let responses: Record<string, unknown> = {};

mock.module('next/headers', () => ({
  headers: async () => ({ get: () => null }),
}));

// Dynamic import so next/headers is mocked before `./page` (and its
// transitive server-api/site-api imports) resolve the real module.
const SiteHomePage = (await import('./page')).default;

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

const searchParams = Promise.resolve({});

describe('SiteHomePage (C16 AC-07)', () => {
  test('shows the site title, search box and the recent guide list', async () => {
    responses = {
      '/site/info': { title: 'Acme Docs', tagline: 'Guides for Acme', indexing: true },
      '/site/guides': {
        guides: [
          { slug: 'first-guide', title: 'First guide', summary: 'A summary', updated_at: '2026-01-01T00:00:00Z', steps: 3 },
        ],
        total: 1,
      },
      '/site/categories': { categories: [] },
    };
    stubFetch();

    const element = await SiteHomePage({ searchParams });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Acme Docs');
    expect(html).toContain('Guides for Acme');
    expect(html).toContain('First guide');
    expect(html).toContain('href="/g/first-guide"');
    expect(html).not.toContain('No guides yet');
  });

  test('shows the empty state telling the owner how to record a guide when there are none', async () => {
    responses = {
      '/site/info': { title: 'Acme Docs', tagline: null, indexing: true },
      '/site/guides': { guides: [], total: 0 },
      '/site/categories': { categories: [] },
    };
    stubFetch();

    const element = await SiteHomePage({ searchParams });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('No guides yet');
  });

  test('shows category cards above the guide list when active categories exist (C17 AC-13)', async () => {
    responses = {
      '/site/info': { title: 'Acme Docs', tagline: null, indexing: true },
      '/site/guides': { guides: [], total: 0 },
      '/site/categories': {
        categories: [{ slug: 'billing', name: 'Billing', description: 'Billing guides', guides: 2 }],
      },
    };
    stubFetch();

    const element = await SiteHomePage({ searchParams });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Browse by category');
    expect(html).toContain('Billing');
    expect(html).toContain('href="/c/billing"');
  });

  test('shows sample guides with bullet in category card and category summary in guide card', async () => {
    responses = {
      '/site/info': { title: 'Acme Docs', tagline: null, indexing: true, guides: 1 },
      '/site/guides': {
        guides: [
          {
            slug: 'invoicing-guide',
            title: 'Invoicing guide',
            summary: 'How to bill clients',
            updated_at: '2026-09-30T12:00:00Z',
            steps: 8,
            category: { slug: 'billing', name: 'Billing' },
          },
        ],
        total: 1,
      },
      '/site/categories': {
        categories: [
          {
            slug: 'billing',
            name: 'Billing',
            description: 'Billing guides',
            guides: 1,
            sample_guides: [{ slug: 'invoicing-guide', title: 'Invoicing guide' }],
          },
        ],
      },
    };
    stubFetch();

    const element = await SiteHomePage({ searchParams });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Search 1 guides, try “template”');
    expect(html).toContain('tenant-category-bullet');
    expect(html).toContain('8 steps · Sep 30');
    expect(html).toContain('tenant-guide-category');
    expect(html).toContain(' · How to bill clients');
  });
});
