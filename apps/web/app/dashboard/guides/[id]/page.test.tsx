import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/headers', () => ({
  headers: async () => ({ get: () => null }),
}));

// GuideSettingsForm is a client component that calls useRouter(); outside a
// real Next router there is no AppRouterContext, so it must be stubbed too.
const realNavigation = await import('next/navigation');
mock.module('next/navigation', () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

// Dynamic import so next/headers and next/navigation are mocked before
// `./page` (and its transitive server-api import) resolve the real modules.
const GuideSettingsPage = (await import('./page')).default;
const { GuideDetailView } = await import('./guide-detail-view');

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

describe('GuideSettingsPage (C18 AC-11)', () => {
  test('loads the guide title into the settings form', async () => {
    responses = {
      '/api/v1/flows?public_id=pub1': {
        items: [{
          public_id: 'pub1',
          title: 'Install the app',
          last_run_at: '2026-01-01T00:00:00Z',
          url: null,
          not_redacted: true,
          slug: 'install-the-app',
          summary: '',
          visibility: 'published',
          steps: 2,
          category: null,
        }],
        next_cursor: null,
      },
      '/api/v1/categories': { categories: [] },
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0' },
      '/api/v1/flows/pub1/steps': { steps: [{ id: 's1', instruction: 'Step 1', image: { width: 100, height: 100 } }] },
    };
    stubFetch();

    const element = await GuideSettingsPage({ params: Promise.resolve({ id: 'pub1' }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Install the app');
    expect(html).toContain('Steps');
    expect(html).toContain('Settings');
    expect(html).toContain('1 step · recorded Jan 1, 2026');
    expect(html).toContain('Preview');
  });

  test('Guide settings tab matches UI-A4 prototype fidelity', () => {
    const guide = {
      public_id: 'pub1',
      title: 'Create a WhatsApp template',
      last_run_at: '2026-09-30T10:00:00.000Z',
      url: 'https://acme.opendocs.xxx/d/pub1',
      not_redacted: true,
      slug: 'create-a-whatsapp-template',
      summary: 'Template guide summary',
      visibility: 'published' as const,
      category: { id: 'c1', name: 'WhatsApp', status: 'suggested' },
      seo_title: 'Create a WhatsApp message template | Acmeco Help',
      seo_description: 'Detailed description for WhatsApp template setup.',
      noindex: false,
    };
    const steps = Array.from({ length: 8 }, (_, i) => ({
      id: `s${i + 1}`,
      order: i + 1,
      action: 'click',
      instruction: `Step ${i + 1}`,
      title: `Step title ${i + 1}`,
      alt: null,
      page_url: null,
      selector: null,
      box: null,
      image: { url: null, width: 100, height: 100 },
    }));

    const element = (
      <GuideDetailView
        guide={guide}
        initialSteps={steps}
        categories={[{ id: 'c1', slug: 'whatsapp', name: 'WhatsApp', status: 'suggested' }]}
        siteHost="acme.opendocs.xxx"
        siteName="Acmeco Help"
        defaultTab="settings"
      />
    );
    const html = renderToStaticMarkup(element);

    // Header actions and sub-copy (Finding 3)
    expect(html).toContain('Create a WhatsApp template');
    expect(html).toContain('8 steps · recorded Sep 30, 2026');
    expect(html).toContain('Preview');
    expect(html).toContain('Save changes');

    // Two-column layout with split (Finding 2)
    expect(html).toContain('class="split"');

    // General card (Finding 2, 8)
    expect(html).toContain('<h3>General</h3>');
    expect(html).toContain('Title');
    expect(html).toContain('Summary');
    expect(html).toContain('Address');
    expect(html).toContain('Category');
    expect(html).toContain('Status');

    // Counters with spaces (Finding 9)
    expect(html.replaceAll('<!-- -->', '')).toContain('26 / 120');
    expect(html.replaceAll('<!-- -->', '')).toContain('22 / 300');
    expect(html.replaceAll('<!-- -->', '')).toContain('48 / 60');
    expect(html.replaceAll('<!-- -->', '')).toContain('49 / 160');

    // Search engines card and toggle (Finding 2, 9)
    expect(html).toContain('<h3>Search engines</h3>');
    expect(html).toContain('Leave empty to use the guide title and summary.');
    expect(html).toContain('class="toggle"');
    expect(html).toContain('Hide this guide from search engines');

    // Previews on the right column as cards (Finding 2, 7)
    expect(html).toContain('<h3>Google preview</h3>');
    expect(html).toContain('<h3>Share preview</h3>');
    expect(html).toContain('acme.opendocs.xxx › g › create-a-whatsapp-template');
    expect(html).toContain('seo-preview-share-banner');
    expect(html).toContain('Acmeco Help');
  });
  test('404s for a guide id that belongs to another workspace (cross-tenant access)', async () => {
    responses = {
      // GET /flows?public_id=... is scoped to the caller's workspace; a
      // foreign id returns an empty items list, same as an unknown id.
      '/api/v1/flows?public_id=someone-elses-guide': { items: [], next_cursor: null },
    };


    stubFetch();

    await expect(
      GuideSettingsPage({ params: Promise.resolve({ id: 'someone-elses-guide' }) }),
    ).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });
});
