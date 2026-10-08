import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DomainsManager } from './domains-manager';
import type { PlatformDomainItem } from '@/lib/server-api';

const sampleDomains: PlatformDomainItem[] = [
  {
    domain: 'docs.example.com',
    tenant: { id: 't-1', name: 'Acmeco Help', slug: 'acme' },
    status: 'verified',
    cert_expires_at: '2026-12-28T00:00:00Z',
    last_checked_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  },
  {
    domain: 'help.northwind.example',
    tenant: { id: 't-2', name: 'Northwind Docs', slug: 'northwind' },
    status: 'waiting_dns',
    cert_expires_at: null,
    last_checked_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  },
  {
    domain: 'support.acme.example',
    tenant: { id: 't-3', name: 'Acme Telco', slug: 'acme' },
    status: 'cert_failing',
    cert_expires_at: '2026-10-04T00:00:00Z',
    last_checked_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  },
  {
    domain: 'free-money.example',
    tenant: { id: 't-4', name: 'Spamly', slug: 'spamly' },
    status: 'blocked',
    cert_expires_at: null,
    last_checked_at: '2026-09-27T00:00:00Z',
  },
];

describe('DomainsManager', () => {
  test('renders domains list with prototype mock rows, columns, badges and footnote', () => {
    const html = renderToStaticMarkup(
      <DomainsManager
        initialDomains={sampleDomains}
        total={4}
        initialFilter="all"
        currentRole="admin"
      />,
    );

    // Header & subtitle
    expect(html).toContain('Domains');
    expect(html).toContain('4 custom domains');
    expect(html).toContain('Needs attention');

    // Table columns & rows
    expect(html).toContain('docs.example.com');
    expect(html).toContain('Acmeco Help');
    expect(html).toContain('href="/platform/tenants/acme"');
    expect(html).toContain('badge-ok'); // Verified
    expect(html).toContain('Verified');
    expect(html).toContain('Dec 28');

    expect(html).toContain('help.northwind.example');
    expect(html).toContain('Northwind Docs');
    expect(html).toContain('badge-warn'); // Waiting for DNS
    expect(html).toContain('Waiting for DNS');

    expect(html).toContain('support.acme.example');
    expect(html).toContain('Acme Telco');
    expect(html).toContain('badge-bad'); // Certificate failing
    expect(html).toContain('Certificate failing');
    expect(html).toContain('Oct 4');

    expect(html).toContain('free-money.example');
    expect(html).toContain('Spamly');
    expect(html).toContain('Blocked');
    expect(html).toContain('Unblock'); // Blocked row shows Unblock button

    // Buttons
    expect(html).toContain('Recheck');
    expect(html).toContain('Block');

    // Footnote
    expect(html).toContain(
      'Blocking a domain takes the site offline on that address; the tenant address keeps working.',
    );
  });

  test('support role has block and unblock buttons disabled', () => {
    const html = renderToStaticMarkup(
      <DomainsManager
        initialDomains={sampleDomains}
        total={4}
        initialFilter="all"
        currentRole="support"
      />,
    );

    // Block & Unblock buttons should have disabled attribute
    expect(html).toContain('disabled=""');
    expect(html).toContain('Platform admin role required');
  });

  test('renders empty state when no domains found', () => {
    const html = renderToStaticMarkup(
      <DomainsManager
        initialDomains={[]}
        total={0}
        initialFilter="all"
        currentRole="admin"
      />,
    );

    expect(html).toContain('No custom domains found');
  });
});
