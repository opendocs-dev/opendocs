import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FlowItem, AdminCategory } from '@/lib/server-api';

const realNavigation = await import('next/navigation');
mock.module('next/navigation', () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

const { GuidesTable, sortGuidesByCategory } = await import('./guides-table');

const categories: AdminCategory[] = [
  { id: 'cat_billing', name: 'Billing', slug: 'billing', status: 'active' },
  { id: 'cat_troubleshooting', name: 'Troubleshooting', slug: 'troubleshooting', status: 'active' },
];

const sampleGuides: FlowItem[] = [
  {
    public_id: 'g1',
    title: 'Troubleshooting guide (older)',
    category: { id: 'cat_troubleshooting', name: 'Troubleshooting' },
    last_run_at: '2026-09-10T00:00:00Z',
    visibility: 'published',
    url: null,
    not_redacted: false,
  },
  {
    public_id: 'g2',
    title: 'Billing guide (newer)',
    category: { id: 'cat_billing', name: 'Billing' },
    last_run_at: '2026-09-25T00:00:00Z',
    visibility: 'published',
    url: null,
    not_redacted: false,
  },
  {
    public_id: 'g3',
    title: 'Billing guide (older)',
    category: { id: 'cat_billing', name: 'Billing' },
    last_run_at: '2026-09-20T00:00:00Z',
    visibility: 'draft',
    url: null,
    not_redacted: false,
  },
  {
    public_id: 'g4',
    title: 'Troubleshooting guide (newer)',
    category: { id: 'cat_troubleshooting', name: 'Troubleshooting' },
    last_run_at: '2026-09-15T00:00:00Z',
    visibility: 'published',
    url: null,
    not_redacted: false,
  },
  {
    public_id: 'g5',
    title: 'Uncategorized guide',
    category: null,
    last_run_at: '2026-09-30T00:00:00Z',
    visibility: 'draft',
    url: null,
    not_redacted: false,
  },
  {
    public_id: 'g6',
    title: 'AI suggested category guide',
    category: { id: 'cat_billing', name: 'Billing', status: 'suggested' },
    last_run_at: '2026-09-28T00:00:00Z',
    visibility: 'published',
    url: null,
    not_redacted: false,
  },
];

describe('sortGuidesByCategory (Finding 13)', () => {
  test('groups guides by category in category order, newest-updated first within groups, uncategorized last', () => {
    const sorted = sortGuidesByCategory(sampleGuides, categories);

    // Expected order:
    // 1. Billing: g2 (newer: Sep 25), g3 (older: Sep 20)
    // 2. Troubleshooting: g4 (newer: Sep 15), g1 (older: Sep 10)
    // 3. Uncategorized (including AI suggested): g5 (newer: Sep 30), g6 (older: Sep 28)
    expect(sorted.map((g) => g.public_id)).toEqual(['g2', 'g3', 'g4', 'g1', 'g5', 'g6']);
  });

  test('sorts by category name if category is not in categories list', () => {
    const customGuides: FlowItem[] = [
      {
        public_id: 'c_guide',
        title: 'C guide',
        category: { id: 'other_2', name: 'Zapier' },
        last_run_at: '2026-09-01T00:00:00Z',
        url: null,
        not_redacted: false,
      },
      {
        public_id: 'a_guide',
        title: 'A guide',
        category: { id: 'other_1', name: 'Analytics' },
        last_run_at: '2026-09-01T00:00:00Z',
        url: null,
        not_redacted: false,
      },
    ];

    const sorted = sortGuidesByCategory(customGuides, []);
    expect(sorted.map((g) => g.public_id)).toEqual(['a_guide', 'c_guide']);
  });
});

describe('GuidesTable (Findings 1, 3, 13)', () => {
  test('renders table rows grouped and sorted by category (Finding 13)', () => {
    const html = renderToStaticMarkup(
      <GuidesTable
        guides={sampleGuides}
        categories={categories}
      />,
    );

    const g2Index = html.indexOf('Billing guide (newer)');
    const g3Index = html.indexOf('Billing guide (older)');
    const g4Index = html.indexOf('Troubleshooting guide (newer)');
    const g1Index = html.indexOf('Troubleshooting guide (older)');
    const g5Index = html.indexOf('Uncategorized guide');
    const g6Index = html.indexOf('AI suggested category guide');

    expect(g2Index).toBeLessThan(g3Index);
    expect(g3Index).toBeLessThan(g4Index);
    expect(g4Index).toBeLessThan(g1Index);
    expect(g1Index).toBeLessThan(g5Index);
    expect(g5Index).toBeLessThan(g6Index);
  });

  test('renders row action menu button instead of stacked View/Delete buttons (Finding 3)', () => {
    const html = renderToStaticMarkup(
      <GuidesTable
        guides={[sampleGuides[0]!]}
        categories={categories}
      />,
    );

    // Should have row-menu-btn
    expect(html).toContain('class="row-menu-btn"');
    expect(html).toContain('aria-label="Actions for Troubleshooting guide (older)"');
    expect(html).toContain('aria-haspopup="menu"');

    // Should NOT have old raw stacked button without menu
    expect(html).not.toContain('class="action-buttons"');
    expect(html).not.toContain('class="btn-danger">Delete</button>');
  });

  test('renders one-click bulk action buttons when rows are selected, instead of select + Apply (Finding 1)', () => {
    const html = renderToStaticMarkup(
      <GuidesTable
        guides={sampleGuides}
        categories={categories}
        initialSelected={['g1', 'g2']}
      />,
    );

    // Bulk bar is visible
    expect(html).toContain('class="bulk-bar"');
    expect(html).toContain('2 selected');

    // One-click action buttons
    expect(html).toContain('Set category');
    expect(html).toContain('Publish');
    expect(html).toContain('Move to draft');
    expect(html).toContain('Clear selection');

    // Does NOT use select + Apply
    expect(html).not.toContain('>Apply</button>');
    expect(html).not.toContain('aria-label="Bulk category"');
    expect(html).not.toContain('aria-label="Bulk status"');
  });
});
