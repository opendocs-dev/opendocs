import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/headers', () => ({
  headers: async () => ({ get: () => null }),
}));

const realNavigation = await import('next/navigation');
mock.module('next/navigation', () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

const AccountPage = (await import('./page')).default;

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

describe('AccountPage', () => {
  test('renders page heading, Save button, and cards for an owner', async () => {
    responses = {
      '/api/v1/account': {
        status: 200,
        body: {
          name: 'Jane Doe',
          email: 'jane@example.com',
          image: null,
          email_notifications: true,
          notify_weekly_digest: true,
          notify_ai_credits: true,
          notify_content_gaps: true,
          notify_invite_accepted: true,
          github_handle: 'janedoe',
        },
      },
      '/api/v1/me': {
        status: 200,
        body: {
          workspace: { id: 'org_1', name: 'Acme Docs' },
          plan: 'pro',
          quota: { files_left: 100, bytes_left: 1000 },
          min_cli_version: '1.0.0',
          role: 'owner',
        },
      },
    };
    stubFetch();

    const element = await AccountPage();
    const html = renderToStaticMarkup(element);

    // Header (UI-A15 Finding 7)
    expect(html).toContain('<h1>Account settings</h1>');
    expect(html).toContain('Your profile on this instance');
    expect(html).toContain('Save');

    // Profile card with editable name and read-only email (UI-A15 Finding 3)
    expect(html).toContain('<h3>Profile</h3>');
    expect(html).toContain('value="Jane Doe"');
    expect(html).toContain('value="jane@example.com"');
    expect(html).toContain('Comes from your GitHub account.');

    // Sign-in card with handle and connected badge (UI-A15 Finding 4)
    expect(html).toContain('<h3>Sign-in</h3>');
    expect(html).toContain('GitHub');
    expect(html).toContain('Connected as @janedoe');
    expect(html).toContain('badge badge-ok');
    expect(html).toContain('Connected');

    // Email notifications card with 4 toggles (UI-A15 Finding 5 & 10)
    expect(html).toContain('<h3>Email notifications</h3>');
    expect(html).toContain('class="toggle"');
    expect(html).toContain('Weekly summary of views and searches');
    expect(html).not.toContain('AI credits');
    expect(html).not.toContain('Leave this workspace');
  });

  test('renders error alert when account fetch fails', async () => {
    responses = {
      '/api/v1/account': { status: 500 },
      '/api/v1/me': {
        status: 200,
        body: {
          workspace: { id: 'org_1', name: 'Acme Docs' },
          plan: 'free',
          quota: { files_left: 50, bytes_left: 500 },
          min_cli_version: '1.0.0',
          role: 'editor',
        },
      },
    };
    stubFetch();

    const element = await AccountPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('role="alert"');
    expect(html).toContain('Could not load account settings.');
  });
});
