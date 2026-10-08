import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/headers', () => ({
  headers: async () => ({ get: () => null }),
}));

const realNavigation = await import('next/navigation');
mock.module('next/navigation', () => ({
  ...realNavigation,
}));

// Dynamic import so next/headers is mocked before `./page` (and its transitive server-api import)
const SignInPage = (await import('./page')).default;

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

describe('SignInPage (UI-A1, AC-06)', () => {
  test('redirects to /admin when user is already signed in', async () => {
    responses = {
      '/api/auth/get-session': {
        status: 200,
        body: { session: { activeOrganizationId: 'org1' }, user: { id: 'u1', name: 'User' } },
      },
    };
    stubFetch();

    await expect(SignInPage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT;replace;/admin'),
    });
  });

  test('renders sign-in card in admin look when signed out', async () => {
    responses = {
      '/api/auth/get-session': { status: 200, body: null },
    };
    stubFetch();

    const element = await SignInPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element);

    // Canvas & admin layout (Finding 6)
    expect(html).toContain('adm adm-auth');
    expect(html).toContain('adm-auth-container');
    expect(html).toContain('card adm-auth-card');

    // Brand mark and product name (Finding 8)
    expect(html).toContain('adm-nav-brand');
    expect(html).toContain('OpenDocs');

    // Card title and subcopy (Finding 4)
    expect(html).toContain('Sign in');
    expect(html).toContain('Already have an account? Continue with the same GitHub login.');

    // Button style and text (Finding 4, 7)
    expect(html).toContain('Continue with GitHub');
    expect(html).toContain('class="btn b"');

    // No error alert by default
    expect(html).not.toContain('Sign-in was cancelled');
  });

  test('renders error alert when cancelled error query param is present', async () => {
    responses = {
      '/api/auth/get-session': { status: 200, body: null },
    };
    stubFetch();

    const element = await SignInPage({
      searchParams: Promise.resolve({ error: 'cancelled' }),
    });
    const html = renderToStaticMarkup(element);

    // Error state alert (Finding 5)
    expect(html).toContain('role="alert"');
    expect(html).toContain('callout bad');
    expect(html).toContain('Sign-in was cancelled');
  });
});
