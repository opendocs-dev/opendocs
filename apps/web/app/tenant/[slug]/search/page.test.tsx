import { afterEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import TenantSearchPage from './page';

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

const params = Promise.resolve({ slug: 'acme' });

describe('TenantSearchPage (C16 AC-09)', () => {
  test('shows the no-results state for a query that matches nothing', async () => {
    responses = {
      '/site/acme/search': { results: [], counts: [] },
    };
    stubFetch();

    const element = await TenantSearchPage({ params, searchParams: Promise.resolve({ q: 'zzz' }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('No guides match');
    expect(html).toContain('zzz');
  });

  test('lists results with title and snippet for a matching query', async () => {
    responses = {
      '/site/acme/search': {
        results: [
          { slug: 'install-app', title: 'Install the app', summary: '', snippet: 'how to <mark>install</mark> it', category: null },
        ],
        counts: [],
      },
    };
    stubFetch();

    const element = await TenantSearchPage({ params, searchParams: Promise.resolve({ q: 'install' }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('1 result for “install”');
    expect(html).toContain('Install');
    expect(html).toContain('the app');
    expect(html).toContain('href="/g/install-app"');
  });

  test('shows category filter chips with counts and marks the selected one (C17 AC-14)', async () => {
    responses = {
      '/site/acme/search': {
        results: [{ slug: 'billing-faq', title: 'Billing FAQ', summary: '', snippet: 'billing', category: { slug: 'billing', name: 'Billing' } }],
        counts: [{ slug: 'billing', name: 'Billing', count: 3 }],
      },
    };
    stubFetch();

    const element = await TenantSearchPage({
      params,
      searchParams: Promise.resolve({ q: 'bill', c: 'billing' }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Billing');
    expect(html).toContain('3');
    expect(html).toContain('aria-current="true"');
  });

  test('the search results page carries noindex (C16 AC-09)', async () => {
    const metadataModule = await import('./page');
    expect(metadataModule.metadata).toEqual({ robots: { index: false, follow: false } });
  });
});
