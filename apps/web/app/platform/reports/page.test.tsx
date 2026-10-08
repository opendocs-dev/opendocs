import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/headers', () => ({
  headers: async () => ({ get: () => 'cookie=mock-cookie' }),
}));

const realNavigation = await import('next/navigation');
mock.module('next/navigation', () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

const ReportsPage = (await import('./page')).default;

const realFetch = globalThis.fetch;
let responses: Record<string, { status: number; body?: unknown }> = {};

function stubFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [match, resp] of Object.entries(responses)) {
      if (url.includes(match)) {
        return new Response(JSON.stringify(resp.body), { status: resp.status });
      }
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  responses = {};
});

describe('ReportsPage server component', () => {
  test('renders ReportsManager with reports and counts on success', async () => {
    responses = {
      '/api/v1/platform/reports': {
        status: 200,
        body: {
          reports: [
            {
              id: 'rep-test',
              type: 'phishing',
              status: 'new',
              text: 'Suspicious card phishing form',
              guide_address: 'free-money.example/g/claim-prize',
              guide_slug: 'claim-prize',
              tenant_name: 'Spamly',
              tenant_slug: 'spamly',
              organization_id: 'org-1',
              flow_id: 'flow-1',
              notes: null,
              reporter_email: null,
              reporter_email_masked: 'v***@example.com',
              reporter_email_revealed: false,
              reporter_email_revealed_at: null,
              guide_visibility: 'published',
              guide_title: 'Claim Prize',
              tenant_status: 'active',
              created_at: '2026-09-30T10:00:00Z',
              updated_at: '2026-09-30T10:00:00Z',
            },
          ],
          counts: { new: 1, in_review: 0, actioned: 0, dismissed: 0, total: 1 },
        },
      },
      '/api/v1/platform/me': {
        status: 200,
        body: {
          staff: { id: 'usr-admin', name: 'Admin User', email: 'admin@example.com', role: 'admin' },
        },
      },
    };
    stubFetch();

    const element = await ReportsPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Reports');
    expect(html).toContain('1 new, 0 in review');
    expect(html).toContain('Phishing');
    expect(html).toContain('Suspicious card phishing form');
  });

  test('renders forbidden notice when user is not staff', async () => {
    responses = {
      '/api/v1/platform/reports': {
        status: 403,
        body: { error: { code: 'unauthorized', message: 'Staff required' } },
      },
      '/api/v1/platform/me': {
        status: 403,
        body: { error: { code: 'unauthorized', message: 'Staff required' } },
      },
    };
    stubFetch();

    const element = await ReportsPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Platform staff access required');
  });
});
