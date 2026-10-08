import { afterEach, describe, expect, test } from 'bun:test';
import { apiOrigin, proxyToApi } from './api-proxy';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('apiOrigin', () => {
  test('reads API_ORIGIN from the given env each call', () => {
    expect(apiOrigin({ API_ORIGIN: 'http://a:1/' })).toBe('http://a:1');
    expect(apiOrigin({ API_ORIGIN: 'http://b:2' })).toBe('http://b:2');
  });
  test('defaults to localhost:4000', () => {
    expect(apiOrigin({})).toBe('http://localhost:4000');
  });
});

describe('proxyToApi', () => {
  test('forwards method, body, headers and query; passes set-cookie and redirects through', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      const h = new Headers({ location: '/x', connection: 'close', 'content-encoding': 'gzip' });
      h.append('set-cookie', 'a=1; Path=/');
      h.append('set-cookie', 'b=2; Path=/');
      return new Response('hi', { status: 302, headers: h });
    }) as unknown as typeof fetch;

    const req = new Request('http://web.test/api/v1/x?y=1', {
      method: 'POST',
      body: '{"a":1}',
      headers: { 'content-type': 'application/json', cookie: 'c=3', connection: 'keep-alive' },
    });
    const res = await proxyToApi(req, '/api/v1/x', { API_ORIGIN: 'http://api:4000' });

    expect(seen?.url).toBe('http://api:4000/api/v1/x?y=1');
    expect(seen?.init.method).toBe('POST');
    const sent = seen?.init.headers as Headers;
    expect(sent.get('cookie')).toBe('c=3');
    expect(sent.has('connection')).toBe(false);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/x');
    expect(res.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/']);
    expect(res.headers.has('content-encoding')).toBe(false);
  });
});
