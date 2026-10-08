import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

const realFetch = globalThis.fetch;
let responses: Record<string, { status: number; body?: unknown }> = {};

function stubFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [match, response] of Object.entries(responses)) {
      if (url.includes(match)) {
        const hasBody = 'body' in response;
        return new Response(hasBody ? JSON.stringify(response.body) : '', {
          status: response.status,
        });
      }
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

mock.module('next/headers', () => ({
  headers: async () => ({ get: () => null }),
}));

const realNavigation = await import('next/navigation');
mock.module('next/navigation', () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/platform/reserved-names',
}));

const { default: ReservedNamesPage } = await import('./page');

describe('ReservedNamesPage (UI-P7 #78)', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
    responses = {};
  });

  test('renders error state with retry when reserved names fail to load', async () => {
    responses = {
      '/api/v1/platform/reserved-names': { status: 500 },
    };
    stubFetch();

    const jsx = await ReservedNamesPage();
    const html = renderToStaticMarkup(jsx);

    expect(html).toContain('Could not load reserved names');
    expect(html).toContain('Retry');
  });

  test('renders reserved names table with prototype fidelity (UI-P7 #78)', async () => {
    responses = {
      '/api/v1/platform/reserved-names': {
        status: 200,
        body: {
          reserved_names: [
            { name: 'api', reason: 'system' },
            { name: 'paypal', reason: 'phishing' },
            { name: 'support', reason: 'trust' },
            { name: 'opendocs', reason: 'brand' },
          ],
        },
      },
    };
    stubFetch();

    const jsx = await ReservedNamesPage();
    const html = renderToStaticMarkup(jsx);

    // Header structure (Finding 1 & 11)
    expect(html).toContain('Reserved names');
    expect(html).toContain('4 names');
    expect(html).toContain('Add name');

    // Split layout (Finding 1)
    expect(html).toContain('class="split"');

    // Names table (Finding 2)
    expect(html).toContain('<code>api</code>');
    expect(html).toContain('<code>paypal</code>');
    expect(html).toContain('System');
    expect(html).toContain('Phishing risk');
    expect(html).toContain('Trust');
    expect(html).toContain('Brand');
    expect(html).toContain('aria-label="Remove api"');
    expect(html).toContain('aria-label="Remove paypal"');

    // Try a name card (Finding 3)
    expect(html).toContain('Try a name');
    expect(html).toContain('Address');
    expect(html).toContain('.opendocs.xxx');
    expect(html).toContain('Names already used by a tenant are also refused, and tenants are told which.');
  });

  test('renders empty state when no reserved names exist', async () => {
    responses = {
      '/api/v1/platform/reserved-names': {
        status: 200,
        body: { reserved_names: [] },
      },
    };
    stubFetch();

    const jsx = await ReservedNamesPage();
    const html = renderToStaticMarkup(jsx);

    expect(html).toContain('0 names');
    expect(html).toContain('No reserved names yet.');
  });
});
