import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PlanMatrixEntry } from '@/lib/server-api';
import { PlanCards, PlanTable, getPlanFeatures } from './plan-table';

const plans: PlanMatrixEntry[] = [
  {
    plan: 'free',
    quota: { files: 200, bytes: 200 * 1024 * 1024 },
    capabilities: {
      presetCount: 1,
      customPreset: false,
      storageKinds: [],
      footerCredit: true,
      aiAssistant: false,
      customDomain: false,
    },
  },
  {
    plan: 'pro',
    quota: { files: 2000, bytes: 2 * 1024 * 1024 * 1024 },
    capabilities: {
      presetCount: 3,
      customPreset: false,
      storageKinds: ['gdrive'],
      footerCredit: false,
      aiAssistant: true,
      customDomain: false,
    },
  },
  {
    plan: 'enterprise',
    quota: { files: 10000, bytes: 10 * 1024 * 1024 * 1024 },
    capabilities: {
      presetCount: 3,
      customPreset: true,
      storageKinds: ['gdrive', 's3'],
      footerCredit: false,
      aiAssistant: true,
      customDomain: true,
    },
  },
];

describe('PlanCards (PlanTable)', () => {
  test('renders all three plans as cards in a 3-column grid without table layout', () => {
    const html = renderToStaticMarkup(<PlanCards currentPlan="free" plans={plans} />);
    expect(html).toContain('grid3');
    expect(html).toContain('Free');
    expect(html).toContain('Pro');
    expect(html).toContain('Enterprise');
    // Verifies Finding 1: no table.adm or table tag
    expect(html).not.toContain('<table');
  });

  test('marks the caller\'s own plan as current with badge and current card class', () => {
    const html = renderToStaticMarkup(<PlanCards currentPlan="pro" plans={plans} />);
    const proIndex = html.indexOf('<h3>Pro</h3>');
    const enterpriseIndex = html.indexOf('<h3>Enterprise</h3>');
    const proSection = html.slice(proIndex, enterpriseIndex);

    expect(proSection).toContain('Current');
    expect(html).toContain('plan-card-current');
  });

  test('does not mark any plan as current when the caller is not on one of the three', () => {
    const html = renderToStaticMarkup(<PlanCards currentPlan="unknown" plans={plans} />);
    expect(html).not.toContain('Current');
    expect(html).not.toContain('plan-card-current');
  });

  test('renders Free plan with 3 included items and 5 excluded items matching UI-A10', () => {
    const freeFeatures = getPlanFeatures(plans[0]);
    const included = freeFeatures.filter((f) => f.included).map((f) => f.text);
    const excluded = freeFeatures.filter((f) => !f.included).map((f) => f.text);

    expect(included).toEqual([
      'Guides, categories, search',
      '1 look preset (Sage)',
      'Images on OpenDocs storage (100 MiB)',
    ]);
    expect(excluded).toEqual([
      'More look presets',
      'No "Powered by OpenDocs" footer',
      'AI assistant',
      'Custom colors, font, logo',
      'Your own domain and custom meta',
    ]);
  });

  test('renders Pro plan with AI assistant 1,000 credits and Google Drive storage', () => {
    const proFeatures = getPlanFeatures(plans[1]);
    const included = proFeatures.filter((f) => f.included).map((f) => f.text);
    const excluded = proFeatures.filter((f) => !f.included).map((f) => f.text);

    expect(included).toContain('AI assistant, 1,000 credits a month');
    expect(included).toContain('Images on own Google Drive');
    expect(included).toContain('3 look presets');
    expect(included).toContain('No "Powered by OpenDocs" footer');
    expect(excluded).toContain('Custom colors, font, logo');
    expect(excluded).toContain('Your own domain and custom meta');
    expect(excluded).toContain('Your own provider, embed anywhere');
  });

  test('renders Enterprise plan with BYOK and 10,000 credits', () => {
    const entFeatures = getPlanFeatures(plans[2]);
    const included = entFeatures.filter((f) => f.included).map((f) => f.text);
    const excluded = entFeatures.filter((f) => !f.included).map((f) => f.text);

    expect(included).toContain('AI assistant, 10,000 credits a month');
    expect(included).toContain('Your own provider, embed anywhere');
    expect(included).toContain('Images on own Drive or S3');
    expect(included).toContain('Custom colors, font, logo');
    expect(included).toContain('Your own domain and custom meta');
    expect(excluded).toHaveLength(0);
  });

  test('PlanTable is aliased to PlanCards for backwards compatibility', () => {
    expect(PlanTable).toBe(PlanCards);
  });
});
