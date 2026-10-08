import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/headers', () => ({
  headers: async () => ({ get: () => null }),
}));

const realNavigation = await import('next/navigation');
mock.module('next/navigation', () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

const MembersPage = (await import('./page')).default;

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

describe('MembersPage (UI-A14)', () => {
  test('renders page header with member count and workspace subtitle, no invite button', async () => {
    responses = {
      '/api/v1/members': {
        members: [
          { id: 'm1', name: 'User 1', email: 'u1@example.com', image: null, role: 'owner', member_since: '2026-09-01T00:00:00Z' },
          { id: 'm2', name: 'User 2', email: 'u2@example.com', image: null, role: 'admin', member_since: '2026-09-01T00:00:00Z' },
          { id: 'm3', name: 'User 3', email: 'u3@example.com', image: null, role: 'editor', member_since: '2026-09-01T00:00:00Z' },
        ],
      },
      '/api/v1/me': {
        workspace: { id: 'ws1', name: 'Acmeco Help' },
        role: 'owner',
      },
    };
    stubFetch();

    const element = await MembersPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('<h1>Members</h1>');
    expect(html).toContain('3 people in Acmeco Help');
    expect(html).not.toContain('Invite');
  });

  test('does not show invite button in header when role is editor', async () => {
    responses = {
      '/api/v1/members': {
        members: [
          { id: 'm1', name: 'User 1', email: 'u1@example.com', image: null, role: 'owner', member_since: '2026-09-01T00:00:00Z' },
        ],
      },
      '/api/v1/me': {
        workspace: { id: 'ws1', name: 'Acmeco Help' },
        role: 'editor',
      },
    };
    stubFetch();

    const element = await MembersPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('1 person in Acmeco Help');
    expect(html).not.toContain('href="#invite"');
  });

  test('renders error and retry link when members fail to load', async () => {
    responses = {
      '/api/v1/me': {
        workspace: { id: 'ws1', name: 'Acmeco Help' },
        role: 'owner',
      },
    };
    stubFetch();

    const element = await MembersPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Could not load members.');
    expect(html).toContain('href="/admin/members"');
  });
});
