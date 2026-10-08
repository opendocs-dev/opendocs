import { afterEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import TenantLayout from './layout';

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

describe('TenantLayout (cross-tenant isolation)', () => {
  test('renders the tenant nav and children for a known, active slug', async () => {
    responses = {
      '/site/acme/info': { title: 'Acme Docs', tagline: '', preset: 'sage', indexing: true, is_free_plan: false, guides: 1 },
    };
    stubFetch();

    const element = await TenantLayout({
      children: <p>page content</p>,
      params: Promise.resolve({ slug: 'acme' }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Acme Docs');
    expect(html).toContain('page content');
    expect(html).toContain('tenant-logo-mark');
    expect(html).toContain('Ask AI');
    expect(html).toContain('Open Acme');
    expect(html).toContain('Contact support');
    expect(html).toContain('tenant-footer');
    expect(html).toContain('Powered by OpenDocs');
    expect(html).toContain('All rights reserved.');
  });

  test('404s for an unknown slug instead of leaking into any tenant content', async () => {
    responses = {}; // every lookup misses -> getSiteInfo returns null

    stubFetch();

    await expect(
      TenantLayout({ children: <p>page content</p>, params: Promise.resolve({ slug: 'ghost-workspace' }) }),
    ).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });

  test("one tenant's slug never resolves another tenant's info (no cross-tenant bleed)", async () => {
    responses = {
      '/site/acme/info': { title: 'Acme Docs', tagline: '', preset: 'sage', indexing: true, is_free_plan: false, guides: 1 },
      // deliberately no entry for 'other-tenant'
    };
    stubFetch();

    await expect(
      TenantLayout({ children: <p>page content</p>, params: Promise.resolve({ slug: 'other-tenant' }) }),
    ).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });

  test('applies custom branding CSS variables over preset when present', async () => {
    responses = {
      '/site/acme/info': {
        title: 'Acme Docs',
        tagline: '',
        preset: 'atlas',
        indexing: true,
        is_free_plan: false,
        guides: 1,
        accent: '#6B2FBF',
        mark: '#FFD54A',
        font: 'DM Sans',
        radius: 10,
      },
    };
    stubFetch();

    const element = await TenantLayout({
      children: <p>page content</p>,
      params: Promise.resolve({ slug: 'acme' }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('--accent:#6B2FBF');
    expect(html).toContain('--mark:#FFD54A');
    expect(html).toContain('--font:DM Sans');
    expect(html).toContain('--radius:10px');
    expect(html).toContain('data-preset="atlas"');
  });
});
