import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/headers', () => ({
  headers: async () => ({ get: () => null }),
}));

// CategoriesManager is a client component that calls useRouter(); outside a
// real Next router there is no AppRouterContext, so it must be stubbed too.
const realNavigation = await import('next/navigation');
mock.module('next/navigation', () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

// Dynamic import so next/headers and next/navigation are mocked before
// `./page` (and its transitive server-api import) resolve the real modules.
const CategoriesPage = (await import('./page')).default;

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

describe('CategoriesPage (C18 AC-12)', () => {
  test('lists categories with their guide counts and shows suggested ones separately', async () => {
    responses = {
      '/api/v1/categories': {
        categories: [
          { id: 'c1', slug: 'billing', name: 'Billing', description: '', position: 0, status: 'active', source: 'user', guides: 3 },
          { id: 'c2', slug: 'whatsapp', name: 'WhatsApp', description: '', position: 1, status: 'suggested', source: 'agent', guides: 1 },
        ],
      },
      '/api/v1/site': {
        address: { slug: 'acme', host: 'acme.opendocs.xxx' },
        site_title: 'Acme',
        tagline: '',
        preset: 'sage',
        indexing: true,
        category_policy: 'suggest',
        domain: { custom_domain: null, status: null, cname_target: '', cert_expires_at: null, last_checked_at: null },
      },
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0', role: 'owner' },
    };
    stubFetch();

    const element = await CategoriesPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Billing');
    expect(html).toContain('WhatsApp');
    // Prototype fidelity checks (UI-A5 #61)
    expect(html).toContain('Group guides on your site and in search');
    expect(html).toContain('New category');
    expect(html).toContain('Your categories');
    expect(html).toContain('/c/billing');
    expect(html).toContain('cat-grip');
    expect(html).toContain('badge');
    expect(html).toContain('Suggested by your agent');
    expect(html).toContain('New names your AI used that you have not approved yet');
    expect(html).toContain('From agent');
    expect(html).toContain('btn btn-primary');
    expect(html).toContain('When an agent sends a new category');
    expect(html).toContain('Applies to every API key in this workspace');
    expect(html).toContain('Suggest it for review');
    expect(html).toContain('Create it automatically');
  });

  test('hides the policy switch for an editor (D2: editor cannot change the category policy)', async () => {
    responses = {
      '/api/v1/categories': { categories: [] },
      '/api/v1/site': {
        address: { slug: 'acme', host: null },
        site_title: 'Acme',
        tagline: '',
        preset: 'sage',
        indexing: true,
        category_policy: 'suggest',
        domain: { custom_domain: null, status: null, cname_target: '', cert_expires_at: null, last_checked_at: null },
      },
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0', role: 'editor' },
    };
    stubFetch();

    const element = await CategoriesPage();
    const html = renderToStaticMarkup(element);

    expect(html).not.toContain('name="policy"');
    expect(html).toContain('Only owners and admins can change this');
  });

  test('shows a retry alert when the categories request fails', async () => {
    responses = {
      '/api/v1/site': {
        address: { slug: 'acme', host: null },
        site_title: 'Acme',
        tagline: '',
        preset: 'sage',
        indexing: true,
        domain: { custom_domain: null, status: null, cname_target: '', cert_expires_at: null, last_checked_at: null },
      },
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0', role: 'owner' },
    };
    stubFetch();

    const element = await CategoriesPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Could not load your categories');
  });
});
