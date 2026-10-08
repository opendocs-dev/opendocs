import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/headers', () => ({
  headers: async () => ({ get: () => null }),
}));

const StoragePage = (await import('./page')).default;

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

describe('StoragePage', () => {
  test('renders header with title and updated subtitle', async () => {
    responses = {
      '/api/v1/me': { role: 'owner', workspace: { id: 'w1', name: 'Acme' } },
      '/api/v1/storage': {
        plan: 'free',
        allowed_kinds: [],
        active_kind: null,
        connections: [],
      },
    };
    stubFetch();

    const element = await StoragePage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Storage');
    expect(html).toContain('Choose where your guide images live');
    expect(html).not.toContain('Choose where your guide images and files are stored');
    expect(html).toContain('OpenDocs storage');
  });

  test('blocks editor role with access restriction message', async () => {
    responses = {
      '/api/v1/me': { role: 'editor', workspace: { id: 'w1', name: 'Acme' } },
      '/api/v1/storage': {
        plan: 'free',
        allowed_kinds: [],
        active_kind: null,
        connections: [],
      },
    };
    stubFetch();

    const element = await StoragePage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Only owners and admins can manage storage.');
    expect(html).not.toContain('OpenDocs storage');
  });

  test('surfaces alert when storage information cannot be loaded', async () => {
    responses = {
      '/api/v1/me': { role: 'owner', workspace: { id: 'w1', name: 'Acme' } },
    };
    stubFetch();

    const element = await StoragePage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Could not load storage information.');
  });
});
