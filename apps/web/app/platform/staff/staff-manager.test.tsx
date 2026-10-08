import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PlatformAuditLogEntry, PlatformStaffMember } from '@/lib/server-api';

const realNavigation = await import('next/navigation');
mock.module('next/navigation', () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

const { StaffManager } = await import('./staff-manager');

const sampleStaff: PlatformStaffMember[] = [
  {
    id: 'staff-1',
    name: 'Ayu Staff',
    email: 'ayu@example.com',
    role: 'admin',
    two_factor_enabled: true,
    last_active_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  },
  {
    id: 'staff-2',
    name: 'Rian Putra',
    email: 'rian@example.com',
    role: 'support',
    two_factor_enabled: false,
    last_active_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  },
];

const sampleAudit: PlatformAuditLogEntry[] = [
  {
    id: 'audit-1',
    created_at: new Date().toISOString(),
    actor_kind: 'staff',
    actor_id: 'staff-1',
    actor_name: 'Ayu Staff',
    actor_email: 'ayu@example.com',
    action: 'Changed role of rian@example.com to Support',
    tenant_name: '–',
    detail: {},
  },
];

describe('StaffManager', () => {
  test('renders staff members, roles, two-step sign-in status, and audit log', () => {
    const html = renderToStaticMarkup(
      <StaffManager
        initialStaff={sampleStaff}
        initialAuditLogs={sampleAudit}
        currentRole="admin"
        currentUserId="staff-1"
      />,
    );

    expect(html).toContain('Staff and audit log');
    expect(html).toContain('2 staff');
    expect(html).toContain('Ayu Staff');
    expect(html).toContain('Rian Putra');
    expect(html).toContain('badge-ok'); // On for two_factor_enabled
    expect(html).toContain('badge-bad'); // Off for two_factor_enabled
    expect(html).toContain('Audit log');
    expect(html).toContain('Changed role of rian@example.com to Support');
    expect(html).toContain('Add staff');
    expect(html).toContain('sr-only'); // Empty actions header
    expect(html).toContain('Today'); // Last active & audit log
    expect(html).not.toContain('padding: 8px 12px 0'); // Audit log title has card's own padding
    expect(html).not.toContain('margin-top: 24px'); // Spacing between cards uses stack gap
  });

  test('support role cannot add or remove staff', () => {
    const html = renderToStaticMarkup(
      <StaffManager
        initialStaff={sampleStaff}
        initialAuditLogs={sampleAudit}
        currentRole="support"
        currentUserId="staff-2"
      />,
    );

    expect(html).not.toContain('Add staff');
    expect(html).not.toContain('Remove');
  });

  test('does not render an inline add form in the page flow (UI-P8 Finding 4)', () => {
    const html = renderToStaticMarkup(
      <StaffManager
        initialStaff={sampleStaff}
        initialAuditLogs={sampleAudit}
        currentRole="admin"
        currentUserId="staff-1"
      />,
    );

    // Initial page flow does not have the add form inline
    expect(html).not.toContain('Add platform staff');
    expect(html).not.toContain('role="dialog"');
  });
});
