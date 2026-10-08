import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

const BASE = 'sites.test';
const realFetch = globalThis.fetch;
let resolved: Record<string, unknown> = {};
let calls = 0;

beforeEach(() => {
  process.env.TENANT_BASE_DOMAIN = BASE;
  calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls++;
    const slug = new URL(String(input)).searchParams.get('slug') ?? '';
    return Response.json(resolved[slug] ?? { status: 'missing' });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.TENANT_BASE_DOMAIN;
});

const req = (host: string, path = '/') =>
  new NextRequest(`https://${host}${path}`, { headers: { host } });

describe('tenant middleware', () => {
  test('unset base domain passes every host through', async () => {
    delete process.env.TENANT_BASE_DOMAIN;
    const res = await middleware(req('acme.sites.test', '/d/abc'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(calls).toBe(0);
  });

  test('a non-tenant host passes through, but /tenant/* is 404 there', async () => {
    expect((await middleware(req('app.example.com', '/d/abc'))).headers.get('x-middleware-next')).toBe('1');
    expect((await middleware(req('app.example.com', '/tenant/acme'))).status).toBe(404);
  });

  test('an active tenant is rewritten to /tenant/<slug>', async () => {
    resolved['acme'] = { status: 'active' };
    const home = await middleware(req('acme.sites.test', '/'));
    expect(home.headers.get('x-middleware-rewrite')).toContain('/tenant/acme');
    const guide = await middleware(req('acme.sites.test', '/g/how-to'));
    expect(guide.headers.get('x-middleware-rewrite')).toContain('/tenant/acme/g/how-to');
  });

  test('unknown, missing and suspended tenants give byte-identical 404s', async () => {
    resolved['gone'] = { status: 'missing' };
    const a = await middleware(req('nobody.sites.test'));
    const b = await middleware(req('gone.sites.test'));
    const c = await middleware(req('app.example.com', '/tenant/x'));
    expect([a.status, b.status, c.status]).toEqual([404, 404, 404]);
    const bodies = await Promise.all([a.text(), b.text(), c.text()]);
    expect(new Set(bodies).size).toBe(1);
  });

  test('an API failure is a 404, not an error', async () => {
    globalThis.fetch = (async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    expect((await middleware(req('boom.sites.test'))).status).toBe(404);
  });

  test('dashboard, api, doc and sign-in paths are 404 on a tenant host', async () => {
    resolved['acme'] = { status: 'active' };
    for (const path of ['/d/abc', '/api/v1/me', '/dashboard', '/sign-in']) {
      expect((await middleware(req('acme.sites.test', path))).status).toBe(404);
    }
  });

  test('a retired address redirects 301 to the current one, keeping path and query', async () => {
    resolved['old'] = { status: 'redirect', slug: 'new' };
    const res = await middleware(req('old.sites.test', '/g/how-to?x=1'));
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://new.sites.test/g/how-to?x=1');
  });

  test('tenant responses never set a cookie', async () => {
    resolved['acme'] = { status: 'active' };
    resolved['old'] = { status: 'redirect', slug: 'acme' };
    for (const host of ['acme.sites.test', 'old.sites.test', 'nobody.sites.test']) {
      expect((await middleware(req(host))).headers.get('set-cookie')).toBeNull();
    }
  });

  test('the base domain itself, a nested label and a trailing dot never reach the dashboard routes', async () => {
    for (const host of ['sites.test', 'a.b.sites.test', 'acme.sites.test.']) {
      expect((await middleware(req(host, '/dashboard'))).status).toBe(404);
    }
  });

  test('a path starting with // cannot redirect off-site', async () => {
    resolved['old'] = { status: 'redirect', slug: 'new' };
    const res = await middleware(req('old.sites.test', '//evil.com/x'));
    expect(res.headers.get('location')).toBe('https://new.sites.test/evil.com/x');
  });
});
