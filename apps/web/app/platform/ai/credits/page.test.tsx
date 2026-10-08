import { afterEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import PlatformAiCreditsPage from './page';

const realFetch = globalThis.fetch;
let responses: Record<string, { status: number; body: unknown }> = {};

function stubFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [match, resp] of Object.entries(responses)) {
      if (url.includes(match)) {
        return new Response(JSON.stringify(resp.body), {
          status: resp.status,
          headers: { 'content-type': 'application/json' },
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

describe('PlatformAiCreditsPage (AC-23)', () => {
  test('renders AI Credits and Limits page with plans and settings', async () => {
    responses = {
      '/api/v1/platform/ai/settings': {
        status: 200,
        body: {
          id: 'global',
          aiEnabled: true,
          spendCapMonthly: 500.0,
          currentMonthSpend: 170.0,
          alertPercent: 80,
          pauseAtCap: true,
          creditOverageAction: 'stop',
          chargeOnlyWhenDelivered: true,
          updatedAt: '2026-10-01T00:00:00Z',
        },
      },
      '/api/v1/platform/ai/plans': {
        status: 200,
        body: {
          plans: [
            {
              plan: 'pro',
              monthlyCredits: 1000,
              byokAllowed: false,
              createdAt: '2026-10-01T00:00:00Z',
              updatedAt: '2026-10-01T00:00:00Z',
            },
          ],
        },
      },
      '/api/v1/platform/me': {
        status: 200,
        body: {
          staff: {
            id: 'u1',
            name: 'Staff Admin',
            email: 'admin@example.com',
            role: 'admin',
          },
        },
      },
    };
    stubFetch();

    const jsx = await PlatformAiCreditsPage();
    const html = renderToStaticMarkup(jsx);
    expect(html).toContain('Credits and limits');
    expect(html).toContain('Monthly credits by plan');
    expect(html).toContain('Save limits');
  });

  test('shows access denied message when user is not staff', async () => {
    responses = {
      '/api/v1/platform/ai/settings': {
        status: 403,
        body: { error: { code: 'unauthorized', message: 'Platform staff access required' } },
      },
      '/api/v1/platform/me': {
        status: 403,
        body: null,
      },
    };
    stubFetch();

    const jsx = await PlatformAiCreditsPage();
    const html = renderToStaticMarkup(jsx);
    expect(html).toContain('Platform staff access required');
    expect(html).toContain('role="alert"');
  });
});
