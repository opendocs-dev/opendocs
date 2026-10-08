import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { contrastRatio, PRESETS } from './appearance-form';
mock.module('next/headers', () => ({
  headers: async () => ({ get: () => null }),
}));

import AppearancePage from './page';

const realFetch = globalThis.fetch;
let responses: Record<string, unknown> = {};

function stubFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [match, body] of Object.entries(responses)) {
      if (url.includes(match)) {
        return new Response(JSON.stringify(body), { status: 200 });
      }
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  responses = {};
});

const SITE = {
  address: { slug: 'acme', host: 'acme.opendocs.xxx' },
  site_title: 'Acme',
  tagline: '',
  preset: 'sage',
  indexing: true,
  category_policy: 'suggest',
  custom_meta: [],
  domain: { custom_domain: null, status: null, cname_target: 'opendocs.xxx', cert_expires_at: null, last_checked_at: null },
};

describe('AppearancePage (C14 AC-11)', () => {
  test('an owner on free plan sees 3 presets, with Atlas and Ledger locked and Pro badge', async () => {
    responses = {
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0', role: 'owner' },
      '/api/v1/site': SITE,
      '/api/v1/plan': {
        plan: 'free',
        quota: { files_left: 10, bytes_left: 1000 },
        plans: [{ plan: 'free', capabilities: { presetCount: 1, customPreset: false } }],
      },
    };
    stubFetch();

    const element = await AppearancePage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Choose how your public site looks');
    expect(html).not.toContain('Choose how your public documentation site looks');
    expect(html).toContain('Presets');
    expect(html).toContain('Sage');
    expect(html).toContain('Atlas');
    expect(html).toContain('Ledger');
    expect(html).toContain('Pro');
    expect(html).toContain('Locked on Free plan');
    expect(html).toContain('Custom branding is on Enterprise');
    expect(html).toContain('Use your own colors, font and logo.');
    expect(html).toContain('Preview');
    expect(html).toContain('Save appearance');
    expect(html).toContain('How can we help?');
    expect(html).toContain('Browse by category');
    expect(html).toContain('Ask AI');
    expect(html).toContain('Upload logo');
    expect(html).toContain('Upload favicon');
    expect(html).toContain('PNG or SVG. Shown in the navbar and browser tab.');
    expect(html).toContain('Preview custom');
    expect(html).toContain('Reset');
  });

  test('an owner on pro plan sees Atlas and Ledger unlocked without Pro badge, Enterprise custom panel locked', async () => {
    responses = {
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'pro', quota: {}, min_cli_version: '1.0.0', role: 'owner' },
      '/api/v1/site': { ...SITE, preset: 'atlas' },
      '/api/v1/plan': {
        plan: 'pro',
        quota: { files_left: 100, bytes_left: 10000 },
        plans: [{ plan: 'pro', capabilities: { presetCount: 3, customPreset: false } }],
      },
    };
    stubFetch();

    const element = await AppearancePage();
    const html = renderToStaticMarkup(element);

    expect(html).not.toContain('Locked on Free plan');
    expect(html).not.toContain('badge badge-ai">Pro<');
    expect(html).toContain('Custom branding is on Enterprise');
    expect(html).toContain('Documentation Preview — Atlas');
  });

  test('an owner on enterprise plan sees all presets unlocked and custom branding active without veil', async () => {
    responses = {
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'enterprise', quota: {}, min_cli_version: '1.0.0', role: 'owner' },
      '/api/v1/site': { ...SITE, preset: 'ledger' },
      '/api/v1/plan': {
        plan: 'enterprise',
        quota: { files_left: 1000, bytes_left: 100000 },
        plans: [{ plan: 'enterprise', capabilities: { presetCount: 3, customPreset: true } }],
      },
    };
    stubFetch();

    const element = await AppearancePage();
    const html = renderToStaticMarkup(element);

    expect(html).not.toContain('Locked on Free plan');
    expect(html).not.toContain('badge badge-ai">Pro<');
    expect(html).not.toContain('card-lock is-locked');
    expect(html).toContain('Custom branding');
    expect(html).toContain('Documentation Preview — Ledger');
  });

  test('an owner on enterprise plan loads saved custom branding into appearance form and preview', async () => {
    responses = {
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'enterprise', quota: {}, min_cli_version: '1.0.0', role: 'owner' },
      '/api/v1/site': {
        ...SITE,
        preset: 'atlas',
        accent: '#7C3AED',
        mark: '#FBBF24',
        font: 'Inter',
        radius: 12,
      },
      '/api/v1/plan': {
        plan: 'enterprise',
        quota: { files_left: 1000, bytes_left: 100000 },
        plans: [{ plan: 'enterprise', capabilities: { presetCount: 3, customPreset: true } }],
      },
    };
    stubFetch();

    const element = await AppearancePage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Documentation Preview — Custom (Atlas)');
    expect(html).toContain('Custom look');
    expect(html).toContain('value="#7C3AED"');
    expect(html).toContain('value="#FBBF24"');
    expect(html).toContain('Corner radius <span>12</span> px');
  });

  test('an editor sees a permission notice instead of the form', async () => {
    responses = {
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0', role: 'editor' },
      '/api/v1/site': SITE,
      '/api/v1/plan': { plan: 'free', quota: {}, plans: [] },
    };
    stubFetch();

    const element = await AppearancePage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Only owners and admins can change appearance settings.');
    expect(html).not.toContain('Save appearance');
  });

  test('shows an alert when site request fails', async () => {
    responses = {
      '/api/v1/me': { workspace: { id: 'org1', name: 'Acme' }, plan: 'free', quota: {}, min_cli_version: '1.0.0', role: 'owner' },
    };
    stubFetch();

    const element = await AppearancePage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Could not load site information');
  });

  test('contrastRatio computes WCAG contrast ratios accurately', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    expect(contrastRatio('#0f6b54', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#ffe066', '#ffffff')).toBeLessThan(4.5);
  });

  test('PRESETS defines exactly sage, atlas, and ledger', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(['sage', 'atlas', 'ledger']);
  });
});
