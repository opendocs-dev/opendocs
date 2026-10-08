import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

let mockDomainsData: any = null;
let mockMeData: any = null;

mock.module('@/lib/server-api', () => ({
  getPlatformDomains: async () => mockDomainsData,
  getPlatformMe: async () => mockMeData,
}));

const { default: PlatformDomainsPage } = await import('./page');

describe('PlatformDomainsPage', () => {
  test('renders forbidden message when user is not staff', async () => {
    mockDomainsData = { data: null, forbidden: true };
    mockMeData = { staff: null, forbidden: true };

    const jsx = await PlatformDomainsPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(jsx);

    expect(html).toContain('Platform staff access required');
  });

  test('renders error state when data fails to load', async () => {
    mockDomainsData = { data: null, forbidden: false };
    mockMeData = { staff: { role: 'admin' }, forbidden: false };

    const jsx = await PlatformDomainsPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(jsx);

    expect(html).toContain('Could not load custom domains');
    expect(html).toContain('Retry');
  });

  test('renders DomainsManager with loaded domains', async () => {
    mockDomainsData = {
      data: {
        domains: [
          {
            domain: 'docs.example.com',
            tenant: { id: 't-1', name: 'Example Docs', slug: 'example' },
            status: 'verified',
            cert_expires_at: null,
            last_checked_at: new Date().toISOString(),
          },
        ],
        total: 1,
      },
      forbidden: false,
    };
    mockMeData = { staff: { role: 'admin' }, forbidden: false };

    const jsx = await PlatformDomainsPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(jsx);

    expect(html).toContain('Domains');
    expect(html).toContain('1 custom domain');
    expect(html).toContain('docs.example.com');
    expect(html).toContain('Example Docs');
  });
});
