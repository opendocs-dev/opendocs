import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/headers', () => ({
  headers: async () => ({ get: () => null }),
}));

// GuidesTable is a client component that calls useRouter(); outside a real
// Next router there is no AppRouterContext, so it must be stubbed too.
const realNavigation = await import('next/navigation');
mock.module('next/navigation', () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

// Dynamic import so next/headers and next/navigation are mocked before
// `./page` (and its transitive server-api import) resolve the real modules.
const GuidesPage = (await import('./page')).default;

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

const searchParams = Promise.resolve({});

describe('GuidesPage (C18 AC-10)', () => {
  test('lists guides with their title and status', async () => {
    responses = {
      '/api/v1/flows': {
        items: [{ public_id: 'pub1', title: 'Install the app', last_run_at: '2026-01-01T00:00:00Z', url: null, not_redacted: true, visibility: 'published' }],
        next_cursor: null,
      },
      '/api/v1/categories': { categories: [] },
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0' },
    };
    stubFetch();

    const element = await GuidesPage({ searchParams });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Install the app');
  });

  test('shows an empty state linking to New guide when there are no guides', async () => {
    responses = {
      '/api/v1/flows': { items: [], next_cursor: null },
      '/api/v1/categories': { categories: [] },
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0' },
    };
    stubFetch();

    const element = await GuidesPage({ searchParams });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('href="/admin/guides/new"');
  });

  test('shows an alert instead of the table when the guide list request fails', async () => {
    responses = {
      // no /api/v1/flows entry -> apiGet returns null
      '/api/v1/categories': { categories: [] },
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0' },
    };
    stubFetch();

    const element = await GuidesPage({ searchParams });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('role="alert"');
  });

  test('shows guide count and uncategorized count in header subtitle (finding 6)', async () => {
    responses = {
      '/api/v1/flows': {
        items: [
          { public_id: 'pub1', title: 'Guide 1', last_run_at: '2026-01-01T00:00:00Z', url: null, not_redacted: false, visibility: 'published', category: { id: 'c1', name: 'Billing' } },
          { public_id: 'pub2', title: 'Guide 2', last_run_at: '2026-01-01T00:00:00Z', url: null, not_redacted: false, visibility: 'draft', category: null },
          { public_id: 'pub3', title: 'Guide 3', last_run_at: '2026-01-01T00:00:00Z', url: null, not_redacted: false, visibility: 'draft', category: { id: 'c2', name: 'Troubleshooting', status: 'suggested' } },
        ],
        next_cursor: null,
      },
      '/api/v1/categories': { categories: [{ id: 'c1', name: 'Billing', slug: 'billing' }, { id: 'c2', name: 'Troubleshooting', slug: 'troubleshooting' }] },
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0' },
    };
    stubFetch();

    const element = await GuidesPage({ searchParams });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('3 guides, 2 without a category');
  });

  test('renders New guide button with plus icon and filter bar with Any status and Search guides (findings 5, 7)', async () => {
    responses = {
      '/api/v1/flows': {
        items: [{ public_id: 'pub1', title: 'Install the app', last_run_at: '2026-01-01T00:00:00Z', url: null, not_redacted: true, visibility: 'published' }],
        next_cursor: null,
      },
      '/api/v1/categories': { categories: [] },
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0' },
    };
    stubFetch();

    const element = await GuidesPage({ searchParams });
    const html = renderToStaticMarkup(element);

    // New guide plus icon
    expect(html).toContain('New guide');
    expect(html).toContain('<svg');
    // Filter bar
    expect(html).toContain('placeholder="Search guides"');
    expect(html).toContain('>Any status</option>');
  });

  test('renders columns with Category, Steps, Status, Views, draft badge tone, and date without year (findings 2, 8, 9, 10)', async () => {
    responses = {
      '/api/v1/flows': {
        items: [
          {
            public_id: 'pub1',
            title: 'Configuring webhooks',
            last_run_at: '2026-09-30T10:00:00Z',
            url: null,
            not_redacted: false,
            visibility: 'draft',
            steps: 5,
            views: 42,
            category: { id: 'c1', name: 'Billing' },
          },
        ],
        next_cursor: null,
      },
      '/api/v1/categories': { categories: [{ id: 'c1', name: 'Billing', slug: 'billing' }] },
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0' },
    };
    stubFetch();

    const element = await GuidesPage({ searchParams });
    const html = renderToStaticMarkup(element);

    // Table header order
    expect(html).toContain('<th>Title</th><th>Category</th><th class="num">Steps</th><th>Status</th><th>Updated</th><th class="num">Views</th>');
    // Bold title link
    expect(html).toContain('class="guide-title"');
    // Draft badge uses badge-warn tone
    expect(html).toContain('badge-warn');
    // Views rendered in numeric cell
    expect(html).toContain('<td class="num">42</td>');
    // Date formatted as Sep 30 without year
    expect(html).toContain('<td>Sep 30</td>');
  });

  test('renders AI suggested category badge in category cell instead of title cell (finding 4)', async () => {
    responses = {
      '/api/v1/flows': {
        items: [
          {
            public_id: 'pub1',
            title: 'Fix DNS issue',
            last_run_at: '2026-09-30T10:00:00Z',
            url: null,
            not_redacted: false,
            visibility: 'published',
            steps: 3,
            views: 10,
            category: { id: 'c2', name: 'Troubleshooting', status: 'suggested' },
          },
        ],
        next_cursor: null,
      },
      '/api/v1/categories': { categories: [{ id: 'c2', name: 'Troubleshooting', slug: 'troubleshooting' }] },
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0' },
    };
    stubFetch();

    const element = await GuidesPage({ searchParams });
    const html = renderToStaticMarkup(element);

    // Should not contain "Suggested by agent" in the title cell
    expect(html).not.toContain('Suggested by agent');
    // Should contain "AI suggests Troubleshooting" in category cell
    expect(html).toContain('AI suggests Troubleshooting');
  });

  test('renders row action menu instead of stacked View/Delete buttons (finding 3)', async () => {
    responses = {
      '/api/v1/flows': {
        items: [
          {
            public_id: 'pub1',
            title: 'Fix DNS issue',
            last_run_at: '2026-09-30T10:00:00Z',
            url: null,
            not_redacted: false,
            visibility: 'published',
            steps: 3,
            views: 10,
            category: null,
          },
        ],
        next_cursor: null,
      },
      '/api/v1/categories': { categories: [] },
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0' },
    };
    stubFetch();

    const element = await GuidesPage({ searchParams });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('class="row-menu-btn"');
    expect(html).toContain('aria-label="Actions for Fix DNS issue"');
    expect(html).not.toContain('class="action-buttons"');
    expect(html).not.toContain('class="btn-danger">Delete</button>');
  });

  test('groups and sorts rows by category in the rendered page (finding 13)', async () => {
    responses = {
      '/api/v1/flows': {
        items: [
          {
            public_id: 'pub_trouble',
            title: 'Troubleshooting guide',
            last_run_at: '2026-09-20T10:00:00Z',
            url: null,
            not_redacted: false,
            visibility: 'published',
            category: { id: 'c2', name: 'Troubleshooting' },
          },
          {
            public_id: 'pub_billing',
            title: 'Billing guide',
            last_run_at: '2026-09-10T10:00:00Z',
            url: null,
            not_redacted: false,
            visibility: 'published',
            category: { id: 'c1', name: 'Billing' },
          },
          {
            public_id: 'pub_uncat',
            title: 'Uncategorized guide',
            last_run_at: '2026-09-30T10:00:00Z',
            url: null,
            not_redacted: false,
            visibility: 'draft',
            category: null,
          },
        ],
        next_cursor: null,
      },
      '/api/v1/categories': {
        categories: [
          { id: 'c1', name: 'Billing', slug: 'billing' },
          { id: 'c2', name: 'Troubleshooting', slug: 'troubleshooting' },
        ],
      },
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0' },
    };
    stubFetch();

    const element = await GuidesPage({ searchParams });
    const html = renderToStaticMarkup(element);

    const billingPos = html.indexOf('Billing guide');
    const troublePos = html.indexOf('Troubleshooting guide');
    const uncatPos = html.indexOf('Uncategorized guide');

    expect(billingPos).toBeLessThan(troublePos);
    expect(troublePos).toBeLessThan(uncatPos);
  });
});
