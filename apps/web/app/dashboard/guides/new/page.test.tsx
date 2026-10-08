import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/headers', () => ({
  headers: async () => ({ get: () => null }),
}));

// Dynamic import so next/headers is mocked before `./page` (and its
// transitive server-api import) resolve the real module.
const NewGuidePage = (await import('./page')).default;

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

describe('NewGuidePage (C18 AC-13)', () => {
  test('passes the workspace category names to the prompt builder as datalist options', async () => {
    responses = {
      '/api/v1/categories': {
        categories: [{ id: 'c1', slug: 'billing', name: 'Billing', description: '', position: 0, status: 'active', source: 'user', guides: 1 }],
      },
    };
    stubFetch();

    const element = await NewGuidePage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('New guide');
    expect(html).toContain('Billing');
  });

  test('renders the prompt builder with no category options when the category request fails', async () => {
    responses = {}; // /api/v1/categories 404s -> getAdminCategories returns null

    stubFetch();

    const element = await NewGuidePage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('New guide');
  });

  test('renders header with subtitle and split layout with all three cards', async () => {
    responses = {
      '/api/v1/categories': { categories: [] },
      '/api/v1/overview': { has_key: false },
    };
    stubFetch();

    const element = await NewGuidePage();
    const html = renderToStaticMarkup(element);

    // Finding 6: Header with subtitle
    expect(html).toContain('Ask your AI agent to record it');

    // Finding 1: Split layout and three cards
    expect(html).toContain('split');
    expect(html).toContain('What should it record?');
    expect(html).toContain('Your prompt');
    expect(html).toContain('Waiting for your agent');

    // Finding 8: textarea rows and start page placeholder
    expect(html).toContain('rows="2"');
    expect(html).toContain('placeholder="https://acme.id/console"');

    // Finding 4: Publish switch toggle
    expect(html).toContain('Publish when recording ends');
    expect(html).toContain('Off keeps it as a draft for you to review.');

    // Finding 5 & 7: "Copy prompt" button without "Go to Guides"
    expect(html).toContain('Copy prompt');
    expect(html).not.toContain('Go to Guides');

    // Finding 10: Neutral callout with "Open setup" when no agent key
    expect(html).toContain('callout neutral');
    expect(html).toContain('No agent connected yet? Set one up in API and MCP.');
    expect(html).toContain('Open setup');
  });

  test('marks Agent connected as done and hides callout when agent key exists', async () => {
    responses = {
      '/api/v1/categories': { categories: [] },
      '/api/v1/overview': { has_key: true },
    };
    stubFetch();

    const element = await NewGuidePage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Waiting for your agent');
    expect(html).toContain('class="done"');
    expect(html).not.toContain('No agent connected yet? Set one up in API and MCP.');
  });
});
