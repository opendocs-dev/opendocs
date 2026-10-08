import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/headers', () => ({
  headers: async () => ({ get: () => null }),
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
  address: { slug: 'acme', host: 'acme.opendocs.xxx' },
  site_title: 'Acmeco Help',
  tagline: '',
  description: 'Guides and documentation for Acme software.',
  preset: 'sage',
  indexing: true,
  category_policy: 'suggest',
  favicon_url: null,
  og_image_url: null,
  custom_meta: [],
  domain: { custom_domain: null, status: null, cname_target: 'opendocs.xxx', cert_expires_at: null, last_checked_at: null },
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
    expect(html).toContain('https://acme.opendocs.xxx/sitemap.xml');

    // Custom meta tags card (Finding 6)
    expect(html).toContain('<h3>Custom meta tags</h3>');
    expect(html).toContain('Enterprise');
    expect(html).toContain('Add verification and social tags to every page head.');
    expect(html).toContain('+ Add tag');
    expect(html).toContain('Scripts, styles and unknown tags are rejected.');

    // Previews on the right as separate cards (Findings 1, 8, 15)
    expect(html).toContain('<h3>Google preview</h3>');
    expect(html).toContain('<h3>Share preview</h3>');
    expect(html).toContain('acme.opendocs.xxx');
    expect(html).toContain('Acmeco Help');
    expect(html).toContain('seo-preview-share-banner');
  });

  test('custom meta tags render in a table with code tags and remove buttons', async () => {
    responses = {
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'enterprise', quota: {}, min_cli_version: '1.0.0', role: 'owner' },
      '/api/v1/site': {
        ...SITE,
        custom_meta: [
          { name: 'google-site-verification', content: 'abc123xyz' },
          { name: 'og:locale', content: 'en_US' },
        ],
      },
    };
    stubFetch();

    const element = await SeoPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('<th>Name or property</th>');
    expect(html).toContain('<th>Content</th>');
    expect(html).toContain('<code>google-site-verification</code>');
    expect(html).toContain('<code>abc123xyz</code>');
    expect(html).toContain('<code>og:locale</code>');
    expect(html).toContain('<code>en_US</code>');
  });

  test('falls back to slug when host is empty so previews do not show bare /', async () => {
    responses = {
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'enterprise', quota: {}, min_cli_version: '1.0.0', role: 'owner' },
      '/api/v1/site': {
        ...SITE,
        address: { slug: 'mybrand', host: null },
      },
    };
    stubFetch();

    const element = await SeoPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('mybrand.opendocs.xxx');
    expect(html).not.toContain('<div class="seo-preview-google-url">/</div>');
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
