import { afterEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import PlatformAiModelsPage from './page';

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

describe('PlatformAiModelsPage (AC-22)', () => {
  test('renders AI Models and Providers page with catalog and credentials', async () => {
    responses = {
      '/api/v1/platform/ai/models': {
        status: 200,
        body: {
          models: [
            {
              id: 'm1',
              provider: 'openai',
              modelId: 'gpt-luna',
              name: 'GPT Luna',
              label: 'Standard',
              creditsPerReply: 1,
              plans: ['pro', 'enterprise'],
              status: 'active',
              isDefault: true,
            },
          ],
        },
      },
      '/api/v1/platform/ai/providers': {
        status: 200,
        body: {
          providers: [
            {
              provider: 'openai',
              baseUrl: null,
              status: 'active',
              hasSecret: true,
              maskedSecret: 'sk-••••3f9a',
              lastTestedAt: new Date().toISOString(),
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

    const jsx = await PlatformAiModelsPage();
    const html = renderToStaticMarkup(jsx);
    expect(html).toContain('AI models and providers');
    expect(html).toContain('GPT Luna');
    expect(html).toContain('Standard');
    expect(html).toContain('Providers');
  });

  test('shows access denied message when user is not staff', async () => {
    responses = {
      '/api/v1/platform/ai/models': {
        status: 403,
        body: { error: { code: 'unauthorized', message: 'Platform staff access required' } },
      },
      '/api/v1/platform/me': {
        status: 403,
        body: null,
      },
    };
    stubFetch();

    const jsx = await PlatformAiModelsPage();
    const html = renderToStaticMarkup(jsx);
    expect(html).toContain('Platform staff access required');
    expect(html).toContain('role="alert"');
  });
});
