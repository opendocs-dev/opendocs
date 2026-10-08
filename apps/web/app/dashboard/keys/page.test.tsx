import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/headers', () => ({
  headers: async () => ({ get: () => null }),
}));

const KeysPage = (await import('./page')).default;

const realFetch = globalThis.fetch;
let responses: Record<string, { status: number; body?: unknown }> = {};

function stubFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [match, response] of Object.entries(responses)) {
      if (url.includes(match)) {
        const hasBody = 'body' in response;
        return new Response(hasBody ? JSON.stringify(response.body) : '', {
          status: response.status,
        });
      }
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  responses = {};
});

describe('KeysPage', () => {
  test('renders header with + New key and split layout when authenticated with workspace', async () => {
    responses = {
      '/api/auth/get-session': {
        status: 200,
        body: {
          session: { activeOrganizationId: 'org_workspace_1' },
          user: { id: 'usr_1', email: 'test@example.com' },
        },
      },
      '/api/auth/api-key/list': {
        status: 200,
        body: { apiKeys: [] },
      },
    };
    stubFetch();

    const element = await KeysPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('<h1>API keys and MCP</h1>');
    expect(html).toContain('+ New key');
    expect(html).toContain('class="btn btn-primary"');
    expect(html).toContain('class="split"');
    expect(html).toContain('<h3>Keys</h3>');
    expect(html).toContain('<h3>Connect your tool</h3>');
  });

  test('renders error message when no workspace is active', async () => {
    responses = {
      '/api/auth/get-session': {
        status: 200,
        body: {
          session: { activeOrganizationId: null },
          user: { id: 'usr_1', email: 'test@example.com' },
        },
      },
    };
    stubFetch();

    const element = await KeysPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('role="alert"');
    expect(html).toContain('No workspace found — try signing in again');
  });
});
