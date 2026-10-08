import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PlatformTenantDetail } from '@/lib/server-api';

const realNavigation = await import('next/navigation');
mock.module('next/navigation', () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

const { TenantDetailClient } = await import('./tenant-detail-client');

const sampleTenant: PlatformTenantDetail = {
  id: 'org-acme',
  name: 'Acmeco Help',
  slug: 'acme',
  address: 'acme.opendocs.xxx',
  created_at: '2026-09-12T00:00:00Z',
  suspended_at: null,
  status: 'active',
  plan: 'enterprise',
  guides_count: 13,
  storage_bytes: 62 * 1024 * 1024 * 1024,
  domain: {
    primary: 'acme.opendocs.xxx',
    custom_domain: 'docs.example.com',
    domain_status: 'verified',
    cert_expires_at: '2026-12-28T00:00:00Z',
    last_checked_at: '2026-10-01T00:00:00Z',
  },
  ai_credits: {
    balance: 9588,
    used_this_month: 412,
    monthly_limit: 10000,
    model: 'GPT Luna',
    byo_set: false,
  },
  audit_logs: [
    {
      id: 'log-1',
      created_at: '2026-09-12T00:00:00Z',
      actor_kind: 'staff',
      actor_id: 'staff-1',
      actor_name: 'Platform Staff',
      action: 'Staff changed plan Pro to Enterprise',
      tenant_name: 'Acmeco Help',
      detail: { reason: 'Annual contract upgrade' },
    },
  ],
};

describe('TenantDetailClient', () => {
  test('renders tenant header, status badge, plan card, ai credits meter, domain checklist, and audit logs', () => {
    const html = renderToStaticMarkup(
      <TenantDetailClient initialTenant={sampleTenant} currentRole="admin" />,
    );

    // Header
    expect(html).toContain('Acmeco Help');
    expect(html).toContain('acme.opendocs.xxx');
    expect(html).toContain('Sep 12, 2026');
    expect(html).toContain('Suspend site');
    expect(html).toContain('badge-ok'); // Active

    // Tabs (shows only Overview; Domains, Guides, Audit log tabs hidden until built)
    expect(html).toContain('Overview');
    expect(html).not.toContain('Domains');
    expect(html).not.toContain('Guides');
    expect(html.match(/role="tab"/g)?.length).toBe(1);

    // Plan card
    expect(html).toContain('Plan');
    expect(html).toContain('Change plan');
    expect(html).toContain('Reason (kept in the audit log)');

    // AI credits card
    expect(html).toContain('AI credits');
    expect(html).toContain('412');
    expect(html).toContain('10,000 used this month');
    expect(html).toContain('model GPT Luna');
    expect(html).toContain('own key not set');
    expect(html).toContain('Grant credits');

    // Domain card
    expect(html).toContain('Domain');
    expect(html).toContain('acme.opendocs.xxx');
    expect(html).toContain('live');
    expect(html).toContain('docs.example.com');
    expect(html).toContain('verified');
    expect(html).toContain('certificate valid until Dec 28, 2026');

    // Audit log card
    expect(html).toContain('Audit log');
    expect(html).toContain('Staff changed plan Pro to Enterprise');
    expect(html).toContain('Annual contract upgrade');
  });

  test('support role has disabled mutation controls with explanation', () => {
    const html = renderToStaticMarkup(
      <TenantDetailClient initialTenant={sampleTenant} currentRole="support" />,
    );

    // Explanations for support role
    expect(html).toContain('Platform admin role required to suspend/restore');
    expect(html).toContain('Platform admin role required to change plan');
    expect(html).toContain('Platform admin role required to grant credits');

    // Buttons should have disabled attribute
    expect(html).toContain('disabled=""');
  });

  test('renders Restore site when tenant is suspended', () => {
    const suspendedTenant: PlatformTenantDetail = {
      ...sampleTenant,
      status: 'suspended',
      suspended_at: '2026-09-25T00:00:00Z',
    };

    const html = renderToStaticMarkup(
      <TenantDetailClient initialTenant={suspendedTenant} currentRole="admin" />,
    );

    expect(html).toContain('Restore site');
    expect(html).toContain('Suspended');
    expect(html).toContain('badge-bad');
  });
});
