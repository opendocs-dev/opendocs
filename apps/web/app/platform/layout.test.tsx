import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

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

mock.module('next/headers', () => ({
  headers: async () => ({ get: () => null }),
}));

const realNavigation = await import('next/navigation');
mock.module('next/navigation', () => ({
  ...realNavigation,
  usePathname: () => '/platform/reserved-names',
}));

const { default: PlatformLayout } = await import('./layout');

describe('PlatformLayout (UI-P7 #78 shell fidelity)', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
    responses = {};
  });

  test('redirects unauthenticated users to /sign-in', async () => {
    responses = {
      '/api/auth/get-session': { status: 200, body: null },
    };
    stubFetch();

    await expect(PlatformLayout({ children: null })).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT;replace;/sign-in'),
    });
  });

  test('renders forbidden message when user is not platform staff', async () => {
    responses = {
      '/api/auth/get-session': {
        status: 200,
        body: { session: { activeOrganizationId: 'org1' }, user: { id: 'u1', name: 'Alice', email: 'alice@example.com' } },
      },
      '/api/v1/platform/me': {
        status: 403,
      },
    };
    stubFetch();

    const jsx = await PlatformLayout({ children: <div>child</div> });
    const html = renderToStaticMarkup(jsx);

    expect(html).toContain('Platform staff access required');
  });

  test('renders platform shell with indigo theme, brand, icon nav and user block (UI-P7 Finding 6 & 7)', async () => {
    responses = {
      '/api/auth/get-session': {
        status: 200,
        body: { session: { activeOrganizationId: 'org1' }, user: { id: 'u1', name: 'Ayu Staff', email: 'ayu@example.com' } },
      },
      '/api/v1/platform/me': {
        status: 200,
        body: { staff: { id: 's1', email: 'ayu@example.com', role: 'admin' } },
      },
    };
    stubFetch();

    const jsx = await PlatformLayout({ children: <div id="test-child">Child Content</div> });
    const html = renderToStaticMarkup(jsx);

    // Shell theme class (Finding 6)
    expect(html).toContain('class="adm adm-platform platform"');

    // Brand block (Finding 7)
    expect(html).toContain('OpenDocs');
    expect(html).toContain('Platform admin');

    // Nav with all routes and icons (Finding 7)
    expect(html).toContain('href="/platform/tenants"');
    expect(html).toContain('Tenants');
    expect(html).toContain('href="/platform/ai/models"');
    expect(html).toContain('AI models');
    expect(html).toContain('href="/platform/ai/credits"');
    expect(html).toContain('Credits and limits');
    expect(html).toContain('href="/platform/domains"');
    expect(html).toContain('Domains');
    expect(html).toContain('href="/platform/reports"');
    expect(html).toContain('Reports');
    expect(html).toContain('href="/platform/reserved-names"');
    expect(html).toContain('Reserved names');
    expect(html).toContain('href="/platform/staff"');
    expect(html).toContain('Staff and audit');

    // Active nav item styling
    expect(html).toContain('class="active"');

    // User block with chevron and role (Finding 7)
    expect(html).toContain('Ayu Staff');
    expect(html).toContain('Platform admin');
    expect(html).toContain('adm-user-icon');

    // Child rendered
    expect(html).toContain('Child Content');
  });
});
