import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/headers', () => ({
  headers: async () => ({ get: () => null }),
}));

const AnalyticsPage = (await import('./page')).default;

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

const SAMPLE_ANALYTICS = {
  days: 30,
  views: 4905,
  searches: 1412,
  searches_with_results_percent: 91,
  marked_helpful_percent: 88,
  views_per_day: [
    { day: '2026-09-01', views: 120 },
    { day: '2026-09-08', views: 175 },
    { day: '2026-09-15', views: 210 },
    { day: '2026-09-22', views: 246 },
    { day: '2026-09-30', views: 290 },
  ],
  top_guides: [
    { id: '1', public_id: 'pub-template', title: 'Create a WhatsApp message template', slug: 'template', views: 1284 },
    { id: '2', public_id: 'pub-device', title: 'Connect a WhatsApp device', slug: 'device', views: 890 },
  ],
  top_searches: [
    { query: 'template', times: 118, results: 3 },
    { query: 'top up', times: 97, results: 2 },
  ],
  searches_without_results: [
    { query: 'change number', times: 24 },
    { query: 'refund', times: 17 },
  ],
};

describe('AnalyticsPage (C14 AC-29)', () => {
  test('renders 4 stat cards with counts and percentages', async () => {
    responses = {
      '/api/v1/analytics': SAMPLE_ANALYTICS,
    };
    stubFetch();

    const element = await AnalyticsPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Analytics');
    expect(html).toContain('4,905');
    expect(html).toContain('Guide views');
    expect(html).toContain('1,412');
    expect(html).toContain('Searches');
    expect(html).toContain('91%');
    expect(html).toContain('Searches with results');
    expect(html).toContain('88%');
    expect(html).toContain('Marked helpful');
  });

  test('renders segmented control for 7, 30, 90 days', async () => {
    responses = {
      '/api/v1/analytics': SAMPLE_ANALYTICS,
    };
    stubFetch();

    const element = await AnalyticsPage({ searchParams: Promise.resolve({ days: '30' }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('href="/admin/analytics?days=7"');
    expect(html).toContain('href="/admin/analytics?days=30"');
    expect(html).toContain('href="/admin/analytics?days=90"');
  });

  test('renders Views per day chart, Top guides, Top searches, and Searches with no results', async () => {
    responses = {
      '/api/v1/analytics': SAMPLE_ANALYTICS,
    };
    stubFetch();

    const element = await AnalyticsPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element);

    // Header uses shared adm-pane-header
    expect(html).toContain('class="adm-pane-header"');
    expect(html).not.toContain('class="page-head"');

    // Chart
    expect(html).toContain('Views per day');
    expect(html).toContain('<svg');

    // Top guides (UI-A19 Finding 5: links to guide settings, restyled without underline and inheriting colour)
    expect(html).toContain('Top guides');
    expect(html).toContain('Create a WhatsApp message template');
    expect(html).toContain('href="/admin/guides/pub-template"');
    expect(html).toContain('color:inherit');
    expect(html).toContain('text-decoration:none');
    expect(html).toContain('1,284');

    // Top searches
    expect(html).toContain('Top searches');
    expect(html).toContain('template');
    expect(html).toContain('118');

    // Searches with no results with "Record a guide" button (btn class, UI-A19 Finding 1)
    expect(html).toContain('Searches with no results');
    expect(html).toContain('refund');
    expect(html).toContain('Record a guide');
    expect(html).toContain('class="btn"');
    expect(html).toContain('href="/admin/guides/new?task=refund"');

    // Numeric table headers
    expect(html).toContain('<th class="num">Views</th>');
    expect(html).toContain('<th class="num">Times</th>');
    expect(html).toContain('<th class="num">Results</th>');

    // No inline marginTop on cards (UI-A19 Finding 7)
    expect(html).not.toContain('style="margin-top:16px"');
    expect(html).not.toContain('style="marginTop:16px"');
  });

  test('shows alert error when analytics fetch fails', async () => {
    responses = {};
    stubFetch();

    const element = await AnalyticsPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Could not load analytics');
    expect(html).toContain('role="alert"');
  });
});
