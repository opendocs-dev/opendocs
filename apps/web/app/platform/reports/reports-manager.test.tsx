import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PlatformReportItem } from '@/lib/server-api';

mock.module('next/navigation', () => ({
  useRouter: () => ({
    refresh: () => {},
    push: () => {},
    replace: () => {},
  }),
  usePathname: () => '/platform/reports',
  useSearchParams: () => new URLSearchParams(),
}));

// Dynamic import after mocking next/navigation
const { ReportsManager } = await import('./reports-manager');

const sampleReports: PlatformReportItem[] = [
  {
    id: 'rep-1',
    type: 'phishing',
    status: 'new',
    text: 'A guide asks readers to enter a card number on another site.',
    guide_address: 'free-money.example/g/claim-prize',
    guide_slug: 'claim-prize',
    tenant_name: 'Spamly',
    tenant_slug: 'spamly',
    organization_id: 'org-spamly',
    flow_id: 'flow-prize',
    notes: null,
    reporter_email: null,
    reporter_email_masked: 'r***@example.com',
    reporter_email_revealed: false,
    reporter_email_revealed_at: null,
    guide_visibility: 'published',
    guide_title: 'Claim Prize',
    tenant_status: 'active',
    created_at: '2026-09-30T12:00:00Z',
    updated_at: '2026-09-30T12:00:00Z',
  },
  {
    id: 'rep-2',
    type: 'personal_data',
    status: 'in_review',
    text: 'A screenshot exposes employee personal API credentials.',
    guide_address: 'acme.opendocs.xxx/g/top-up-balance',
    guide_slug: 'top-up-balance',
    tenant_name: 'Acmeco Help',
    tenant_slug: 'acme',
    organization_id: 'org-acme',
    flow_id: 'flow-balance',
    notes: 'Checking with security team.',
    reporter_email: null,
    reporter_email_masked: 'j***@company.org',
    reporter_email_revealed: false,
    reporter_email_revealed_at: null,
    guide_visibility: 'published',
    guide_title: 'Top Up Balance',
    tenant_status: 'active',
    created_at: '2026-09-28T09:00:00Z',
    updated_at: '2026-09-29T10:00:00Z',
  },
  {
    id: 'rep-3',
    type: 'copyright',
    status: 'actioned',
    text: 'Northwind logo pack used without permission.',
    guide_address: 'northwind.opendocs.xxx/g/logo-pack',
    guide_slug: 'logo-pack',
    tenant_name: 'Northwind Docs',
    tenant_slug: 'northwind',
    organization_id: 'org-northwind',
    flow_id: 'flow-logos',
    notes: 'Guide taken down.',
    reporter_email: null,
    reporter_email_masked: 'l***@northwind.com',
    reporter_email_revealed: false,
    reporter_email_revealed_at: null,
    guide_visibility: 'draft',
    guide_title: 'Logo Pack',
    tenant_status: 'active',
    created_at: '2026-09-25T14:00:00Z',
    updated_at: '2026-09-26T15:00:00Z',
  },
];

const sampleCounts = {
  new: 1,
  in_review: 1,
  actioned: 1,
  dismissed: 0,
  total: 3,
};

describe('ReportsManager (UI-P6)', () => {
  test('renders reports list, subtitle, badges, and detail card for first report by default', () => {
    const html = renderToStaticMarkup(
      <ReportsManager
        initialReports={sampleReports}
        initialCounts={sampleCounts}
        currentRole="admin"
        currentUserId="usr-admin-1"
      />,
    );

    // Screen title and subtitle matching mock
    expect(html).toContain('Reports');
    expect(html).toContain('1 new, 1 in review');
    expect(html).toContain('Abuse and takedown reports from readers or rights holders');

    // Filter tabs
    expect(html).toContain('All (3)');
    expect(html).toContain('New (1)');
    expect(html).toContain('In review (1)');
    expect(html).toContain('Actioned (1)');

    // Left list rows
    expect(html).toContain('Phishing');
    expect(html).toContain('free-money.example/g/claim-prize');
    expect(html).toContain('Spamly');
    expect(html).toContain('New');

    expect(html).toContain('Personal data');
    expect(html).toContain('acme.opendocs.xxx/g/top-up-balance');
    expect(html).toContain('Acmeco Help');
    expect(html).toContain('In review');

    expect(html).toContain('Copyright');
    expect(html).toContain('northwind.opendocs.xxx/g/logo-pack');
    expect(html).toContain('Northwind Docs');
    expect(html).toContain('Actioned');

    // Detail card for first selected report
    expect(html).toContain('A guide asks readers to enter a card number on another site.');
    expect(html).toContain('Reported by a reader, Sep 30 (email hidden from staff by default).');
    expect(html).toContain('Reveal email');

    // Actions
    expect(html).toContain('Open guide');
    expect(html).toContain('Unpublish guide');
    expect(html).toContain('Suspend tenant');
    expect(html).toContain('Dismiss');

    // Note field
    expect(html).toContain('Note (kept in the audit log)');
    expect(html).toContain('Save note');
  });

  test('support role cannot unpublish or suspend (buttons disabled)', () => {
    const html = renderToStaticMarkup(
      <ReportsManager
        initialReports={sampleReports}
        initialCounts={sampleCounts}
        currentRole="support"
        currentUserId="usr-support-1"
      />,
    );

    expect(html).toContain('disabled');
    expect(html).toContain('Platform admin role required to unpublish guides');
    expect(html).toContain('Platform admin role required to suspend tenants');
  });

  test('renders empty queue state when no reports', () => {
    const html = renderToStaticMarkup(
      <ReportsManager
        initialReports={[]}
        initialCounts={{ new: 0, in_review: 0, actioned: 0, dismissed: 0, total: 0 }}
        currentRole="admin"
        currentUserId="usr-admin-1"
      />,
    );

    expect(html).toContain('No reports in queue');
    expect(html).toContain('All abuse and takedown reports in this view have been processed.');
  });
});
