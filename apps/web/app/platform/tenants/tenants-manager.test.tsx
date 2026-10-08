import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TenantsManager } from './tenants-manager';
import type { PlatformTenantItem } from '@/lib/server-api';

const sampleTenants: PlatformTenantItem[] = [
  {
    id: 't-1',
    name: 'Acmeco Help',
    slug: 'acme',
    address: 'acme.opendocs.xxx',
    plan: 'enterprise',
    guides_count: 13,
    storage_bytes: 62 * 1024 * 1024 * 1024,
    status: 'active',
    created_at: '2026-09-12T00:00:00Z',
  },
  {
    id: 't-2',
    name: 'Northwind Docs',
    slug: 'northwind',
    address: 'northwind.opendocs.xxx',
    plan: 'pro',
    guides_count: 48,
    storage_bytes: Math.round(8.1 * 1024 * 1024 * 1024),
    status: 'active',
    created_at: '2026-09-15T00:00:00Z',
  },
  {
    id: 't-3',
    name: 'Spamly',
    slug: 'spamly',
    address: 'spamly.opendocs.xxx',
    plan: 'free',
    guides_count: 61,
    storage_bytes: Math.round(0.9 * 1024 * 1024 * 1024),
    status: 'suspended',
    created_at: '2026-09-20T00:00:00Z',
  },
];

describe('TenantsManager', () => {
  test('renders tenants list with columns, formatted numbers, badges, and open buttons', () => {
    const html = renderToStaticMarkup(
      <TenantsManager
        initialTenants={sampleTenants}
        total={214}
        currentPage={1}
        totalPages={11}
      />,
    );

    expect(html).toContain('Tenants');
    expect(html).toContain('3 of 214 shown');
    expect(html).toContain('Search name or address');
    expect(html).toContain('Any plan');

    // Table rows
    expect(html).toContain('Acmeco Help');
    expect(html).toContain('acme.opendocs.xxx');
    expect(html).toContain('badge-ai'); // Enterprise badge
    expect(html).toContain('62 GiB');
    expect(html).toContain('8.1 GiB');
    expect(html).toContain('0.9 GiB');

    // Status badges
    expect(html).toContain('Active');
    expect(html).toContain('Suspended');
    expect(html).toContain('badge-bad');

    // Open button linking to P2
    expect(html).toContain('href="/platform/tenants/acme"');
    expect(html).toContain('href="/platform/tenants/northwind"');
    expect(html).toContain('href="/platform/tenants/spamly"');
    expect(html).toContain('Open');

    // Pagination
    expect(html).toContain('Page 1 of 11');
    expect(html).toContain('Next');
  });

  test('renders empty state when no tenants found', () => {
    const html = renderToStaticMarkup(
      <TenantsManager
        initialTenants={[]}
        total={0}
        currentPage={1}
        totalPages={1}
      />,
    );

    expect(html).toContain('No tenants found');
  });
});
