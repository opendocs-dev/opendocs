import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/font/google', () => ({
  Bricolage_Grotesque: () => ({ variable: 'font-bricolage' }),
  Figtree: () => ({ variable: 'font-figtree' }),
}));

mock.module('next/headers', () => ({
  headers: async () => ({
    get: (key: string) => (key === 'host' ? 'opendocs.test' : null),
  }),
}));

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

const DOC = {
  public_id: 'doc-123',
  title: 'Order a coffee',
  steps: [
    { order: 1, action: 'click', instruction: 'Choose espresso', page_url: 'https://cafe.test/menu', image: { url: null, expired: false } },
    { order: 2, action: 'click', instruction: 'Confirm checkout', page_url: 'https://cafe.test/cart', image: { url: null, expired: false } },
  ],
};

describe('DocPage (AC-04)', () => {
  test('hero shows count and host', async () => {
    responses = {
      '/api/v1/docs/doc-123': DOC,
    };
    stubFetch();

    const DocPage = (await import('./page')).default;
    const element = await DocPage({
      params: Promise.resolve({ id: 'doc-123' }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('<b>2</b> steps');
    expect(html).toContain('On cafe.test');
    expect(html).toContain('Order a coffee');
  });

  test('no "Made with" footer is rendered', async () => {
    responses = {
      '/api/v1/docs/doc-123': DOC,
    };
    stubFetch();

    const DocPage = (await import('./page')).default;
    const element = await DocPage({
      params: Promise.resolve({ id: 'doc-123' }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).not.toContain('Made with');
  });

  test('renders mobile progress bar under header with meter and step count', async () => {
    responses = {
      '/api/v1/docs/doc-123': DOC,
    };
    stubFetch();

    const DocPage = (await import('./page')).default;
    const element = await DocPage({
      params: Promise.resolve({ id: 'doc-123' }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('class="doc-mobile-bar"');
    expect(html).toContain('1 of 2 steps · 0 done');
    expect(html).toContain('class="meter"');
  });

  test('renders step grid with column 1 step-no and column 2 step-content', async () => {
    responses = {
      '/api/v1/docs/doc-123': DOC,
    };
    stubFetch();

    const DocPage = (await import('./page')).default;
    const element = await DocPage({
      params: Promise.resolve({ id: 'doc-123' }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('class="step-no"');
    expect(html).toContain('class="step-content"');
  });
});
