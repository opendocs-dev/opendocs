import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/headers', () => ({
  headers: async () => ({ get: (k: string) => (k === 'host' ? 'docs.example.test' : null) }),
}));

// Dynamic import so next/headers is mocked before `./page` resolves server-api.
const SeoPage = (await import('./page')).default;

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

const SITE = {
  site_title: 'Acmeco Help',
  tagline: '',
  description: 'Guides and documentation for Acme software.',
  preset: 'sage',
  indexing: true,
  category_policy: 'suggest',
  favicon_url: null,
  og_image_url: null,
};

describe('SeoPage / UI-A8 Fidelity', () => {
  test('an owner sees two-column layout, header Save button, Indexing card with toggles, and Previews', async () => {
    responses = {
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'enterprise', quota: {}, min_cli_version: '1.0.0', role: 'owner' },
      '/api/v1/site': SITE,
    };
    stubFetch();

    const element = await SeoPage();
    const html = renderToStaticMarkup(element);

    // Header & Save placement (Findings 2, 9)
    expect(html).toContain('<h1>SEO</h1>');
    expect(html).toContain('Control how search engines and social apps show your site');
    expect(html).toContain('Save SEO settings');

    // Two-column layout (Finding 1)
    expect(html).toContain('class="split"');

    // Site card (Findings 5, 9, 10)
    expect(html).toContain('<h3>Site</h3>');
    expect(html).toContain('Site title');
    expect(html).toContain('Default description');
    // Counter with spaces, no title counter
    expect(html.replaceAll('<!-- -->', '')).toContain('43 / 160');
    expect(html).not.toContain('9/60');
    expect(html).not.toContain('9 / 60');

    // Share image and favicon upload buttons and hint (Finding 5)
    expect(html).toContain('Upload share image');
    expect(html).toContain('Upload favicon');
    expect(html).toContain('Share image 1200 x 630 px.');

    // Indexing card and toggles (Findings 3, 4)
    expect(html).toContain('<h3>Indexing</h3>');
    expect(html).toContain('class="toggle"');
    expect(html).toContain('Let search engines index my site');
    expect(html).toContain('Off keeps every page out of search results.');
    expect(html).toContain('Publish sitemap.xml and robots.txt');
    expect(html).toContain('https://docs.example.test/sitemap.xml');

    // Custom meta tags are gone with the multi-tenant features (C23)
    expect(html).not.toContain('Custom meta tags');

    // Previews on the right as separate cards (Findings 1, 8, 15)
    expect(html).toContain('<h3>Google preview</h3>');
    expect(html).toContain('<h3>Share preview</h3>');
    expect(html).toContain('docs.example.test');
    expect(html).toContain('Acmeco Help');
    expect(html).toContain('seo-preview-share-banner');
  });

  test('editor-only role sees read-only card and no editable form', async () => {
    responses = {
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'enterprise', quota: {}, min_cli_version: '1.0.0', role: 'editor' },
      '/api/v1/site': SITE,
    };
    stubFetch();

    const element = await SeoPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Only owners and admins can change site settings.');
    expect(html).not.toContain('Save SEO settings');
    expect(html).not.toContain('Upload share image');
  });

  test('displays error message when site fails to load', async () => {
    responses = {
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'enterprise', quota: {}, min_cli_version: '1.0.0', role: 'owner' },
    };
    stubFetch();

    const element = await SeoPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Could not load site information. Refresh the page to try again.');
  });
});
