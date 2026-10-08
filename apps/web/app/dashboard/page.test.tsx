import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/headers', () => ({
  headers: async () => ({ get: () => null }),
}));

// Dynamic import so next/headers is mocked before `./page` (and its
// transitive server-api import) resolve the real module.
const DashboardPage = (await import('./page')).default;

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

describe('DashboardPage (C14 AC-07, overview)', () => {
  test('shows Welcome back header, host line, header buttons, and stat counters (findings 2, C14-AC07)', async () => {
    responses = {
      '/api/v1/me': {
        workspace: { id: 'org1', name: 'Acme' },
        plan: 'free',
        quota: { files_left: 10, bytes_left: 1000 },
        min_cli_version: '1.0.0',
        site_host: 'acme.opendocs.xxx',
      },
      '/api/v1/overview': {
        published: 4,
        unlisted: 1,
        draft: 2,
        uncategorized: 0,
        suggested_categories: 0,
        has_key: true,
        has_guide: true,
        site_host: 'acme.opendocs.xxx',
        views_30d: 1284,
        searches: 312,
        storage_used: '62%',
      },
      '/api/v1/flows': { items: [], next_cursor: null },
      '/api/v1/site': {
        address: { slug: 'acme', host: 'acme.opendocs.xxx' },
        site_title: 'Acme',
        tagline: '',
        description: '',
        preset: 'sage',
        indexing: true,
        favicon_url: null,
        og_image_url: null,
        custom_meta: [],
        domain: { custom_domain: null, status: null, cname_target: '', cert_expires_at: null, last_checked_at: null },
      },
    };
    stubFetch();

    const element = await DashboardPage();
    const html = renderToStaticMarkup(element);

    // Header (finding 2)
    expect(html).toContain('Welcome back');
    expect(html).toContain('Acme is live at acme.opendocs.xxx');
    expect(html).toContain('View site');
    expect(html).toContain('href="https://acme.opendocs.xxx"');
    expect(html).toContain('+ New guide');
    expect(html).toContain('/dashboard/guides/new');

    // Stats
    expect(html).toContain('<b>4</b>');
    expect(html).toContain('Published guides');
    expect(html).toContain('1,284');
    expect(html).toContain('Views, last 30 days');
    expect(html).toContain('312');
    expect(html).toContain('Searches');
    expect(html).toContain('62%');
    expect(html).toContain('Storage used');
    expect(html).not.toContain('guides have no category');
  });

  test('shows the uncategorized callout, naming suggested categories, only when there is something to review', async () => {
    responses = {
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0' },
      '/api/v1/overview': {
        published: 1,
        unlisted: 0,
        draft: 0,
        uncategorized: 3,
        suggested_categories: 2,
        has_key: true,
        has_guide: true,
        site_host: null,
      },
      '/api/v1/flows': { items: [], next_cursor: null },
    };
    stubFetch();

    const element = await DashboardPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('3 guides have no category.');
    expect(html).toContain('Your agent suggested categories for all of them');
    expect(html).toContain('Review suggestions');
    expect(html).toContain('href="/dashboard/categories"');
  });

  test('shows singular copy for 1 uncategorized guide and links to guides uncategorized filter when no suggestions (finding 10)', async () => {
    responses = {
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0' },
      '/api/v1/overview': {
        published: 1,
        unlisted: 0,
        draft: 0,
        uncategorized: 1,
        suggested_categories: 0,
        has_key: true,
        has_guide: true,
        site_host: null,
      },
      '/api/v1/flows': { items: [], next_cursor: null },
    };
    stubFetch();

    const element = await DashboardPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('1 guide has no category.');
    expect(html).not.toContain('1 guides have no category.');
    expect(html).toContain('Review guides');
    expect(html).toContain('href="/dashboard/guides?category=none"');
  });

  test('shows an alert instead of counters when the overview request fails', async () => {
    responses = {
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0' },
      // no /api/v1/overview entry -> apiGet returns null
      '/api/v1/flows': { items: [], next_cursor: null },
    };
    stubFetch();

    const element = await DashboardPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Could not load overview');
  });

  test('renders Recently published card with flow title, category, views and handles errors (findings 1, 3)', async () => {
    responses = {
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0', site_host: 'acme.opendocs.xxx' },
      '/api/v1/overview': {
        published: 2,
        unlisted: 0,
        draft: 0,
        uncategorized: 0,
        suggested_categories: 0,
        has_key: true,
        has_guide: true,
        site_host: 'acme.opendocs.xxx',
      },
      '/api/v1/flows': {
        items: [
          {
            public_id: 'flow_1',
            title: 'Onboarding Flow',
            slug: 'onboarding',
            visibility: 'published',
            category: { id: 'cat_1', name: 'Getting Started' },
            views: 412,
            last_run_at: new Date().toISOString(),
            url: null,
            not_redacted: false,
          },
        ],
        next_cursor: null,
      },
    };
    stubFetch();

    const element = await DashboardPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Recently published');
    expect(html).not.toContain('Recent guides');
    expect(html).toContain('Onboarding Flow');
    expect(html).toContain('Getting Started');
    expect(html).toContain('412 views');
    expect(html).not.toContain('steps');
  });

  test('renders error alert when recent guides request fails (finding 1)', async () => {
    responses = {
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0' },
      '/api/v1/overview': {
        published: 0,
        unlisted: 0,
        draft: 0,
        uncategorized: 0,
        suggested_categories: 0,
        has_key: false,
        has_guide: false,
        site_host: null,
      },
      // /api/v1/flows omitted -> returns null
    };
    stubFetch();

    const element = await DashboardPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Could not load recent guides');
  });

  test('renders 5 setup checklist items with appropriate links and done states (finding 4)', async () => {
    responses = {
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0', site_host: null },
      '/api/v1/overview': {
        published: 0,
        unlisted: 0,
        draft: 0,
        uncategorized: 0,
        suggested_categories: 0,
        has_key: false,
        has_guide: false,
        site_host: null,
      },
      '/api/v1/flows': { items: [], next_cursor: null },
      '/api/v1/site': {
        address: { slug: 'acme', host: null },
        site_title: 'Acme',
        tagline: '',
        description: '',
        preset: 'sage',
        indexing: true,
        favicon_url: null,
        og_image_url: null,
        custom_meta: [],
        domain: { custom_domain: null, status: null, cname_target: '', cert_expires_at: null, last_checked_at: null },
      },
    };
    stubFetch();

    const element = await DashboardPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Set up your site');
    expect(html).toContain('Claim your address');
    expect(html).toContain('href="/dashboard/site"');
    expect(html).toContain('Connect an AI agent');
    expect(html).toContain('href="/dashboard/keys"');
    expect(html).toContain('Publish your first guide');
    expect(html).toContain('href="/dashboard/guides/new"');
    expect(html).toContain('Choose a look for your site');
    expect(html).toContain('href="/dashboard/site/appearance"');
    expect(html).toContain('Connect your own domain');
  });
});
