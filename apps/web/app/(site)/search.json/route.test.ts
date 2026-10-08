import { afterEach, describe, expect, test } from 'bun:test';

import { GET } from './route';

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

const request = (q: string) => new Request(`https://acme.opendocs.test/search.json?q=${encodeURIComponent(q)}`);

describe('GET /search.json (C16 AC-08, live search box)', () => {
  test('returns an empty result list without calling the API for a blank query', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const response = await GET(request(''));
    const body = await response.json();

    expect(body).toEqual({ results: [] });
    expect(called).toBe(false);
  });

  test('caps results at 5 even when the API returns more', async () => {
    responses = {
      '/site/search': {
        results: Array.from({ length: 8 }, (_, i) => ({
          slug: `guide-${i}`,
          title: `Guide ${i}`,
          summary: '',
          snippet: '',
          category: null,
        })),
        counts: [],
      },
    };
    stubFetch();

    const response = await GET(request('guide'));
    const body = await response.json();

    expect(body.results).toHaveLength(5);
  });
});
