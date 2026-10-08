import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

const realFetch = globalThis.fetch;
let responses: Record<string, unknown> = {};

mock.module('next/headers', () => ({
  headers: async () => ({ get: (key: string) => (key === 'host' ? 'acme.opendocs.test' : null) }),
}));

// Dynamic import so next/headers is mocked before `./page` (and its
// transitive site-api import) resolve the real module.
const SiteGuidePage = (await import('./page')).default;

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

const GUIDE = {
  public_id: 'pub1',
  title: 'Install the app',
  steps: [
    { order: 1, action: 'click', instruction: 'Open the store', page_url: 'https://acme.test/store', image: { url: null, expired: false } },
    { order: 2, action: 'click', instruction: 'Tap install', page_url: 'https://acme.test/store', image: { url: null, expired: false } },
  ],
  slug: 'install-the-app',
  summary: 'Install guide',
  visibility: 'published',
  updated_at: '2026-09-30T12:00:00Z',
  prev: { slug: 'earlier-guide', title: 'Earlier guide' },
  next: { slug: 'later-guide', title: 'Later guide' },
  category: { slug: 'whatsapp', name: 'WhatsApp' },
};

describe('SiteGuidePage (C16 AC-10, AC-11, UI-R4 #83)', () => {
  test('renders every step and the previous/next guide links', async () => {
    responses = {
      '/site/guides/install-the-app': GUIDE,
    };
    stubFetch();

    const element = await SiteGuidePage({
      params: Promise.resolve({ guide: 'install-the-app' }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Open the store');
    expect(html).toContain('Tap install');
    expect(html).toContain('href="/g/earlier-guide"');
    expect(html).toContain('href="/g/later-guide"');
  });

  test('renders the helpful vote prompt (C14 AC-04, Finding 8)', async () => {
    responses = {
      '/site/guides/install-the-app': GUIDE,
    };
    stubFetch();

    const element = await SiteGuidePage({
      params: Promise.resolve({ guide: 'install-the-app' }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Was this guide helpful?');
    expect(html).toContain('Yes');
    expect(html).toContain('No');
  });

  test('omits the previous link on the first guide and the next link on the last', async () => {
    responses = {
      '/site/guides/install-the-app': { ...GUIDE, prev: null, next: null },
    };
    stubFetch();

    const element = await SiteGuidePage({
      params: Promise.resolve({ guide: 'install-the-app' }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).not.toContain('href="/g/earlier-guide"');
    expect(html).not.toContain('href="/g/later-guide"');
  });

  test('renders same-category guides in the left column with current guide highlighted (Finding 2)', async () => {
    responses = {
      '/site/guides/install-the-app': GUIDE,
      '/site/guides?limit=50&offset=0&category=whatsapp': {
        guides: [
          { slug: 'install-the-app', title: 'Install the app' },
          { slug: 'connect-device', title: 'Connect device' },
        ],
        total: 2,
      },
    };
    stubFetch();

    const element = await SiteGuidePage({
      params: Promise.resolve({ guide: 'install-the-app' }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('<h4>WhatsApp</h4>');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/g/connect-device"');
  });

  test('renders breadcrumb ending at category without the guide title (Finding 3)', async () => {
    responses = {
      '/site/guides/install-the-app': GUIDE,
    };
    stubFetch();

    const element = await SiteGuidePage({
      params: Promise.resolve({ guide: 'install-the-app' }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('href="/c/whatsapp"');
    expect(html).toContain('WhatsApp');
    // Breadcrumb should not contain guide title as its last item
    const breadcrumbHtml = html.match(/<nav class="tenant-breadcrumb"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? '';
    expect(breadcrumbHtml).not.toContain('Install the app');
  });

  test('renders hero title block with steps count, updated date, host, and lede summary (Finding 4)', async () => {
    responses = {
      '/site/guides/install-the-app': GUIDE,
    };
    stubFetch();

    const element = await SiteGuidePage({
      params: Promise.resolve({ guide: 'install-the-app' }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('2 steps');
    expect(html).toContain('Updated Sep 30, 2026');
    expect(html).toContain('Recorded on acme.test');
    expect(html).toContain('tenant-guide-lede');
    expect(html).toContain('Install guide');
  });

  test('renders previous and next guide links as cards (Finding 6)', async () => {
    responses = {
      '/site/guides/install-the-app': GUIDE,
    };
    stubFetch();

    const element = await SiteGuidePage({
      params: Promise.resolve({ guide: 'install-the-app' }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('tenant-guide-nav-card');
    expect(html).toContain('Previous:');
    expect(html).toContain('Earlier guide');
    expect(html).toContain('Next:');
    expect(html).toContain('Later guide');
  });

  test('omits the doc-page footer on the tenant guide page (Finding 7)', async () => {
    responses = {
      '/site/guides/install-the-app': GUIDE,
    };
    stubFetch();

    const element = await SiteGuidePage({
      params: Promise.resolve({ guide: 'install-the-app' }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).not.toContain('Recorded by an AI agent with OpenDocs');
    expect(html).not.toContain('Make a guide like this');
  });

  test('renders the 38px step circle for step number (Finding 5)', async () => {
    responses = {
      '/site/guides/install-the-app': GUIDE,
    };
    stubFetch();

    const element = await SiteGuidePage({
      params: Promise.resolve({ guide: 'install-the-app' }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('class="step-circle"');
  });

  test('shows a Draft badge for a draft guide and omits the helpful vote', async () => {
    responses = {
      '/site/guides/install-the-app': { ...GUIDE, visibility: 'draft' },
    };
    stubFetch();

    const element = await SiteGuidePage({
      params: Promise.resolve({ guide: 'install-the-app' }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('tenant-draft-badge');
    expect(html).toContain('Draft');
    expect(html).not.toContain('Was this guide helpful?');
  });

  test('has no Report this guide entry (reports were removed with the platform)', async () => {
    responses = {
      '/site/guides/install-the-app': GUIDE,
    };
    stubFetch();

    const element = await SiteGuidePage({
      params: Promise.resolve({ guide: 'install-the-app' }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).not.toContain('Report this guide');
    expect(html).not.toContain('tenant-draft-badge');
  });

  test('404s for a guide slug that does not exist on this tenant (and the same for another workspace or draft)', async () => {
    responses = {}; // every lookup 404s
    stubFetch();

    await expect(
      SiteGuidePage({ params: Promise.resolve({ guide: 'missing-guide' }) }),
    ).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });
});
