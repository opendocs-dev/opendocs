import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

const realFetch = globalThis.fetch;
let responses: Record<string, { status: number; body?: unknown }> = {};

mock.module('next/headers', () => ({
  headers: async () => ({ get: (key: string) => (key === 'cookie' ? 'session=abc' : null) }),
}));

// NavLinks is a client component that calls usePathname(); outside a real
// Next router there is no pathname context, so it must be stubbed too.
const realNavigation = await import('next/navigation');
mock.module('next/navigation', () => ({
  ...realNavigation,
  usePathname: () => '/admin',
}));

// Dynamic import so next/headers and next/navigation are mocked before
// `./layout` (and its transitive server-api import) resolve the real modules.
const AdminLayout = (await import('./layout')).default;

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

describe('AdminLayout (C18 admin auth gate)', () => {
  test('redirects to /sign-in when there is no session (access without login)', async () => {
    responses = {
      '/api/auth/get-session': { status: 200, body: null },
    };
    stubFetch();

    await expect(AdminLayout({ children: null })).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT;replace;/sign-in'),
    });
  });

  test('redirects to /sign-in when the session request itself is unauthorized', async () => {
    responses = {
      '/api/auth/get-session': { status: 401 },
    };
    stubFetch();

    await expect(AdminLayout({ children: null })).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT;replace;/sign-in'),
    });
  });

  test('an owner session renders the Site and API keys menu links', async () => {
    responses = {
      '/api/auth/get-session': {
        status: 200,
        body: { session: { activeOrganizationId: 'org1' }, user: { id: 'u1', name: 'Jo Owner' } },
      },
      '/api/v1/me': {
        status: 200,
        body: { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0', role: 'owner' },
      },
    };
    stubFetch();

    const element = await AdminLayout({ children: null });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('href="/admin/site/appearance"');
    expect(html).toContain('href="/admin/keys"');
    expect(html).toContain('<small>Owner</small>');
  });

  test("an editor session hides the Site and API keys links (role-based menu, D2/D4)", async () => {
    responses = {
      '/api/auth/get-session': {
        status: 200,
        body: { session: { activeOrganizationId: 'org1' }, user: { id: 'u2', name: 'Jo Editor' } },
      },
      '/api/v1/me': {
        status: 200,
        body: { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0', role: 'editor' },
      },
    };
    stubFetch();

    const element = await AdminLayout({ children: null });
    const html = renderToStaticMarkup(element);

    expect(html).not.toContain('href="/admin/site/appearance"');
    expect(html).not.toContain('href="/admin/keys"');
    expect(html).toContain('href="/admin/categories"');
    expect(html).toContain('<small>Editor</small>');
  });

  test('shows the banner for an @opendocs.test user', async () => {
    responses = {
      '/api/auth/get-session': {
        status: 200,
        body: {
          session: { activeOrganizationId: 'org1' },
          user: { id: 'u-e2e', name: 'E2E Tester', email: 'e2e@opendocs.test' },
        },
      },
      '/api/v1/me': {
        status: 200,
        body: { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0', role: 'owner' },
      },
    };
    stubFetch();

    const element = await AdminLayout({ children: null });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('role="status"');
    expect(html).toContain('adm-test-banner');
    expect(html).toContain('Test session (login bypass). Not a real account.');
  });

  test('hides it for a real user', async () => {
    responses = {
      '/api/auth/get-session': {
        status: 200,
        body: {
          session: { activeOrganizationId: 'org1' },
          user: { id: 'u-real', name: 'Real User', email: 'real@example.com' },
        },
      },
      '/api/v1/me': {
        status: 200,
        body: { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0', role: 'owner' },
      },
    };
    stubFetch();

    const element = await AdminLayout({ children: null });
    const html = renderToStaticMarkup(element);

    expect(html).not.toContain('Test session (login bypass). Not a real account.');
    expect(html).not.toContain('adm-test-banner');
  });
});
