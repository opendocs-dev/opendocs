import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CreditsManager } from './credits-manager';
import type { PlatformAiSettings, PlatformPlanConfig } from '@/lib/server-api';

const mockSettings: PlatformAiSettings = {
  id: 'global',
  aiEnabled: true,
  spendCapMonthly: 500.0,
  currentMonthSpend: 170.0, // 34%
  alertPercent: 80,
  pauseAtCap: true,
  creditOverageAction: 'stop',
  chargeOnlyWhenDelivered: true,
  updatedAt: '2026-10-01T00:00:00Z',
};

const mockPlans: PlatformPlanConfig[] = [
  {
    plan: 'free',
    monthlyCredits: 0,
    byokAllowed: false,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
  {
    plan: 'pro',
    monthlyCredits: 1000,
    byokAllowed: false,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
  {
    plan: 'enterprise',
    monthlyCredits: 10000,
    byokAllowed: true,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
];

describe('CreditsManager (UI-P4)', () => {
  test('renders page title, subtitle and Save limits primary button', () => {
    const html = renderToStaticMarkup(
      <CreditsManager initialSettings={mockSettings} initialPlans={mockPlans} currentRole="admin" />,
    );
    expect(html).toContain('Credits and limits');
    expect(html).toContain('1 credit = 1 reply to a reader');
    expect(html).toContain('Save limits');
  });

  test('renders Monthly credits by plan table with exact mock requirements', () => {
    const html = renderToStaticMarkup(
      <CreditsManager initialSettings={mockSettings} initialPlans={mockPlans} currentRole="admin" />,
    );
    expect(html).toContain('Monthly credits by plan');
    expect(html).toContain('free');
    expect(html).toContain('Not allowed');
    expect(html).toContain('AI assistant is off');
    expect(html).toContain('pro');
    expect(html).toContain('Catalog models marked Pro');
    expect(html).toContain('enterprise');
    expect(html).toContain('Catalog models marked Enterprise');
    expect(html).toContain(
      'Numbers are examples. Credits reset on the 1st of each month. A reply through a tenant&#x27;s own key costs 0 credits.',
    );
  });

  test('renders When credits run out card with radios and charge toggle', () => {
    const html = renderToStaticMarkup(
      <CreditsManager initialSettings={mockSettings} initialPlans={mockPlans} currentRole="admin" />,
    );
    expect(html).toContain('When credits run out');
    expect(html).toContain('Stop AI replies');
    expect(html).toContain('The owner is emailed at 80% and 100%');
    expect(html).toContain('Let the owner add credits');
    expect(html).toContain('An &quot;Add credits&quot; button appears in their admin');
    expect(html).toContain('Charge only when a reply is delivered');
    expect(html).toContain('A failed model call costs nothing');
  });

  test('renders Platform spend cap card with 34% meter, cap input, alert radios, and pause toggle', () => {
    const html = renderToStaticMarkup(
      <CreditsManager initialSettings={mockSettings} initialPlans={mockPlans} currentRole="admin" />,
    );
    expect(html).toContain('Platform spend cap');
    expect(html).toContain('What all tenants together may cost us in provider fees this month.');
    expect(html).toContain('34% of the cap used');
    expect(html).toContain('Monthly cap ($)');
    expect(html).toContain('70%');
    expect(html).toContain('80%');
    expect(html).toContain('90%');
    expect(html).toContain('Pause AI for everyone when the cap is reached');
    expect(html).toContain('Readers see the contact options; guides and search keep working.');
  });

  test('read-only view for support staff shows notice and hides save buttons', () => {
    const html = renderToStaticMarkup(
      <CreditsManager initialSettings={mockSettings} initialPlans={mockPlans} currentRole="support" />,
    );
    expect(html).toContain('Read-only access:');
    expect(html).not.toContain('Save limits');
  });
});
