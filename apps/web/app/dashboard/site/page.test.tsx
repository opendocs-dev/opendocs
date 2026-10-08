import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/headers', () => ({
  headers: async () => ({ get: () => null }),
}));

// Dynamic import so next/headers is mocked before `./page` (and its
// transitive server-api import) resolve the real module.
const SitePage = (await import('./page')).default;

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

const SITE = {
  address: { slug: 'acme', host: 'acme.opendocs.xxx' },
  site_title: 'Acme',
  tagline: '',
  preset: 'sage',
  indexing: true,
  category_policy: 'suggest',
  domain: { custom_domain: null, status: null, cname_target: 'opendocs.xxx', cert_expires_at: null, last_checked_at: null },
};

describe('SitePage / Domain (UI-A7 fidelity)', () => {
  test('an owner sees the editable address form with Your address, Live badge, and locked Enterprise domain on free plan', async () => {
    responses = {
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0', role: 'owner' },
      '/api/v1/site': SITE,
      '/api/v1/plan': {
        plan: 'free',
        quota: {},
        plans: [{ plan: 'free', capabilities: { customDomain: false } }],
      },
    };
    stubFetch();

    const element = await SitePage();
    const html = renderToStaticMarkup(element);

    expect(html).not.toContain('Only owners and admins can change the address');
    expect(html).toContain('<h1>Domain</h1>');
    expect(html).toContain('Where people find your guides');
    expect(html).toContain('Your address');
    expect(html).toContain('Live');
    expect(html).toContain('Changing it keeps the old address redirecting for 90 days so links do not break.');
    expect(html).toContain('acme.opendocs.xxx');
    expect(html).toContain('Change address');
    expect(html).toContain('Your own domain');
    expect(html).toContain('card-lock is-locked');
    expect(html).toContain('Your own domain is on Enterprise');
    expect(html).toContain('docs.example.com');
    expect(html).toContain('Verify');
  });

  test('an owner on enterprise plan sees Your own domain unlocked without veil', async () => {
    responses = {
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'enterprise', quota: {}, min_cli_version: '1.0.0', role: 'owner' },
      '/api/v1/site': SITE,
      '/api/v1/plan': {
        plan: 'enterprise',
        quota: {},
        plans: [{ plan: 'enterprise', capabilities: { customDomain: true } }],
      },
    };
    stubFetch();

    const element = await SitePage();
    const html = renderToStaticMarkup(element);

    expect(html).not.toContain('card-lock is-locked');
    expect(html).not.toContain('Your own domain is on Enterprise');
    expect(html).toContain('Your own domain');
    expect(html).toContain('Enterprise');
    expect(html).toContain('Verify');
  });

  test('renders DNS record table and checklist when a custom domain exists', async () => {
    responses = {
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'enterprise', quota: {}, min_cli_version: '1.0.0', role: 'owner' },
      '/api/v1/site': {
        ...SITE,
        domain: {
          custom_domain: 'docs.acme.com',
          status: 'verified',
          cname_target: 'acme.opendocs.xxx',
          cert_expires_at: null,
          last_checked_at: '2026-10-04T00:00:00Z',
        },
      },
      '/api/v1/plan': {
        plan: 'enterprise',
        quota: {},
        plans: [{ plan: 'enterprise', capabilities: { customDomain: true } }],
      },
    };
    stubFetch();

    const element = await SitePage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Add this record at your DNS provider');
    expect(html).toContain('CNAME');
    expect(html).toContain('docs');
    expect(html).toContain('acme.opendocs.xxx');
    expect(html).toContain('Copy');
    expect(html).toContain('DNS record found');
    expect(html).toContain('Issuing certificate');
    expect(html).toContain('Site reachable');
    expect(html).toContain('Recheck DNS');
    expect(html).toContain('Clear domain');
  });

  test('unifies fallback to .opendocs.xxx when host is null', async () => {
    responses = {
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0', role: 'owner' },
      '/api/v1/site': {
        ...SITE,
        address: { slug: 'acme', host: null },
      },
      '/api/v1/plan': {
        plan: 'free',
        quota: {},
        plans: [{ plan: 'free', capabilities: { customDomain: false } }],
      },
    };
    stubFetch();

    const element = await SitePage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('acme.opendocs.xxx');
    expect(html).not.toContain('.your-domain');
  });

  test('an editor sees a read-only notice instead of the address form', async () => {
    responses = {
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0', role: 'editor' },
      '/api/v1/site': SITE,
    };
    stubFetch();

    const element = await SitePage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Only owners and admins can change the address');
    expect(html).toContain('acme');
  });

  test('shows an alert instead of the form when the site request fails', async () => {
    responses = {
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0', role: 'owner' },
    };
    stubFetch();

    const element = await SitePage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Could not load site information');
  });
});
