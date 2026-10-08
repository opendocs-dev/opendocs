import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FlowItem, AdminCategory } from '@/lib/server-api';

const realNavigation = await import('next/navigation');
mock.module('next/navigation', () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

const { GuideSettingsForm } = await import('./guide-settings-form');

const MOCK_GUIDE: FlowItem = {
  public_id: 'WrbILDybFCcDYmWb',
  title: 'Create a WhatsApp template',
  last_run_at: '2026-09-30T10:00:00.000Z',
  url: 'https://acme.opendocs.xxx/d/WrbILDybFCcDYmWb',
  not_redacted: true,
  slug: 'create-a-whatsapp-template',
  summary: 'A short guide summary.',
  visibility: 'published',
  category: { id: 'c1', name: 'WhatsApp', status: 'suggested' },
  seo_title: 'Create a WhatsApp message template | Acmeco Help',
  seo_description: 'Follow these steps to create a WhatsApp template.',
  noindex: false,
};

const MOCK_CATEGORIES: AdminCategory[] = [
  { id: 'c1', slug: 'whatsapp', name: 'WhatsApp', status: 'suggested' },
  { id: 'c2', slug: 'integrations', name: 'Integrations', status: 'active' },
];

describe('GuideSettingsForm (UI-A4 Fidelity)', () => {
  test('renders two-column layout with General and Search engines cards and Previews', () => {
    const html = renderToStaticMarkup(
      <GuideSettingsForm
        guide={MOCK_GUIDE}
        categories={MOCK_CATEGORIES}
        siteName="Acmeco Help"
      />,
    );

    // Layout
    expect(html).toContain('class="split"');

    // General card
    expect(html).toContain('<h3>General</h3>');
    expect(html).toContain('Title');
    expect(html).toContain('Summary');
    expect(html).toContain('Address');
    expect(html).toContain('Category');
    expect(html).toContain('Status');

    // Search engines card
    expect(html).toContain('<h3>Search engines</h3>');
    expect(html).toContain('Leave empty to use the guide title and summary.');
    expect(html).toContain('Page title');
    expect(html).toContain('Page description');
    expect(html).toContain('class="toggle"');
    expect(html).toContain('Hide this guide from search engines');

    // Previews on the right
    expect(html).toContain('<h3>Google preview</h3>');
    expect(html).toContain('<h3>Share preview</h3>');
    expect(html).toContain('acme.opendocs.xxx › g › create-a-whatsapp-template');
    expect(html).toContain('seo-preview-share-banner');
    expect(html).toContain('Acmeco Help');

    // Save button wrapped in .btns
    expect(html).toContain('class="btns"');
    expect(html).toContain('Save changes');
  });

  test('formats counters with spaces and displays editable address with warning', () => {
    const html = renderToStaticMarkup(
      <GuideSettingsForm
        guide={MOCK_GUIDE}
        categories={MOCK_CATEGORIES}
      />,
    );

    // Counters with spaces
    expect(html.replaceAll('<!-- -->', '')).toContain('26 / 120');
    expect(html.replaceAll('<!-- -->', '')).toContain('22 / 300');
    expect(html.replaceAll('<!-- -->', '')).toContain('48 / 60');
    expect(html.replaceAll('<!-- -->', '')).toContain('49 / 160');

    // Address (Finding 4): editable input, /g/ suffix, warning
    expect(html).toContain('value="create-a-whatsapp-template"');
    expect(html).toContain('<span>/g/</span>');
    expect(html).toContain('Changing the address changes the guide link. Old links are not redirected.');

    // Category suggested note (Finding 6): uses mock copy with agent choice
    expect(html).toContain('Your agent chose WhatsApp when it recorded this guide.');
    expect(html).toContain('cat-sparkle');

    // Status radio cards (Finding 5)
    expect(html).toContain('class="radio-group"');
    expect(html).toContain('Visible on your site and in search.');
    expect(html).toContain('Only people with the link. Not in search or sitemap.');
    expect(html).toContain(
      'Hidden on your site. The direct link /d/WrbILDybFCcDYmWb still opens for anyone who has it.',
    );
  });

  test('does not show suggested category note when category is not suggested', () => {
    const activeCatGuide: FlowItem = {
      ...MOCK_GUIDE,
      category: { id: 'c2', name: 'Integrations', status: 'active' },
    };

    const html = renderToStaticMarkup(
      <GuideSettingsForm
        guide={activeCatGuide}
        categories={MOCK_CATEGORIES}
      />,
    );

    expect(html).not.toContain('Your agent chose');
    expect(html).not.toContain('cat-sparkle');
  });

  test('falls back to /d/{id} when no site host or draft status', () => {
    const draftGuide: FlowItem = {
      ...MOCK_GUIDE,
      visibility: 'draft',
    };

    const html = renderToStaticMarkup(
      <GuideSettingsForm
        guide={draftGuide}
        categories={MOCK_CATEGORIES}
      />,
    );

    expect(html).toContain('/d/WrbILDybFCcDYmWb');
  });
});
