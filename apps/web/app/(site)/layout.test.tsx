import { afterEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import SiteLayout from './layout';

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

describe('SiteLayout', () => {
  test('renders the site nav and children, with no Ask AI when the assistant is off', async () => {
    responses = {
      '/site/info': { title: 'Acme Docs', tagline: '', preset: 'sage', indexing: true, guides: 1 },
    };
    stubFetch();

    const element = await SiteLayout({
      children: <p>page content</p>,
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Acme Docs');
    expect(html).toContain('page content');
    expect(html).toContain('tenant-logo-mark');
    expect(html).not.toContain('Ask AI');
    expect(html).toContain('Open Acme');
    expect(html).toContain('Contact support');
    expect(html).toContain('tenant-footer');
    expect(html).toContain('Powered by OpenDocs');
    expect(html).toContain('All rights reserved.');
  });

  test('404s when site info cannot be loaded', async () => {
    responses = {}; // every lookup misses -> getSiteInfo returns null

    stubFetch();

    await expect(
      SiteLayout({ children: <p>page content</p>}),
    ).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });

  test('shows the Ask AI pill and panel only when the assistant is enabled', async () => {
    responses = {
      '/site/info': {
        title: 'Acme Docs',
        tagline: '',
        preset: 'sage',
        indexing: true,
        guides: 1,
        assistant: { enabled: true, button_label: 'Ask AI' },
      },
    };
    stubFetch();

    const element = await SiteLayout({ children: <p>page content</p> });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('tenant-ask-ai-pill');
    expect(html).toContain('tenant-ask-ai-floating');
  });

  test('applies custom branding CSS variables over preset when present', async () => {
    responses = {
      '/site/info': {
        title: 'Acme Docs',
        tagline: '',
        preset: 'atlas',
        indexing: true,
        guides: 1,
        accent: '#6B2FBF',
        mark: '#FFD54A',
        font: 'DM Sans',
        radius: 10,
      },
    };
    stubFetch();

    const element = await SiteLayout({
      children: <p>page content</p>,
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('--accent:#6B2FBF');
    expect(html).toContain('--mark:#FFD54A');
    expect(html).toContain('--font:DM Sans');
    expect(html).toContain('--radius:10px');
    expect(html).toContain('data-preset="atlas"');
  });
});
