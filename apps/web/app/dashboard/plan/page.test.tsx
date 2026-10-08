import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/headers', () => ({
  headers: async () => ({ get: () => null }),
}));

const PlanPage = (await import('./page')).default;

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

const defaultPlans = [
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

describe('PlanPage', () => {
  test('renders header with subtitle You are on Enterprise and Contact sales button (Finding 5)', async () => {
    responses = {
      '/api/v1/plan': {
        plan: 'enterprise',
        quota: { files_left: 10000, bytes_left: 10 * 1024 * 1024 * 1024 },
        plans: defaultPlans,
      },
    };
    stubFetch();

    const element = await PlanPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Plan and usage');
    expect(html).toContain('You are on <strong>Enterprise</strong>');
    expect(html).toContain('Contact sales');
    expect(html).not.toContain('Compare what Free, Pro and Enterprise include');
  });

  test('renders usage meter cards including daily upload usage card as third meter card (UI-A10 Owner decision 3, Finding 4, 10)', async () => {
    responses = {
      '/api/v1/plan': {
        plan: 'enterprise',
        quota: { files_left: 10000, bytes_left: 10 * 1024 * 1024 * 1024 },
        plans: defaultPlans,
      },
      '/api/v1/storage': {
        plan: 'enterprise',
        allowed_kinds: ['gdrive', 's3'],
        active_kind: 's3',
        connections: [],
        usage: { bytes_used: 500 * 1024 * 1024, bytes_limit: 10000 * 1024 * 1024 },
      },
      '/api/v1/assistant': {
        assistant: {},
        credits: { used: 412, total: 10000, percent: 4, reset_date: 'Nov 1' },
      },
    };
    stubFetch();

    const element = await PlanPage();
    const html = renderToStaticMarkup(element);

    // Two new meters
    expect(html).toContain('<h3>Image storage</h3>');
    expect(html).toContain('500 of 10,000 MiB on own Drive or S3 (Enterprise)');
    expect(html).toContain('<h3>AI credits this month</h3>');
    expect(html).toContain('412 of 10,000 credits (1 credit = 1 reply)');
    expect(html).toContain('class="meter"');
    expect(html).toContain('class="meter-fill"');

    // Third meter card: daily upload usage
    expect(html).toContain('<h3>Your plan: Enterprise</h3>');
    expect(html).toContain('0 / 10,000 files');
    expect(html).toContain('aria-label="Files used today"');
    expect(html).toContain('0 MB / 10.0 GB');
  });

  test('updates subtitle and storage caption when on Free plan (Finding 6)', async () => {
    responses = {
      '/api/v1/plan': {
        plan: 'free',
        quota: { files_left: 200, bytes_left: 200 * 1024 * 1024 },
        plans: defaultPlans,
      },
      '/api/v1/storage': {
        plan: 'free',
        allowed_kinds: [],
        active_kind: null,
        connections: [],
        usage: { bytes_used: 62 * 1024 * 1024, bytes_limit: 100 * 1024 * 1024 },
      },
    };
    stubFetch();

    const element = await PlanPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('You are on <strong>Free</strong>');
    expect(html).toContain('62 of 100 MiB on OpenDocs storage (Free)');
  });

  test('updates subtitle and storage caption when on Pro plan with Google Drive (Finding 6)', async () => {
    responses = {
      '/api/v1/plan': {
        plan: 'pro',
        quota: { files_left: 2000, bytes_left: 2 * 1024 * 1024 * 1024 },
        plans: defaultPlans,
      },
      '/api/v1/storage': {
        plan: 'pro',
        allowed_kinds: ['gdrive'],
        active_kind: 'gdrive',
        connections: [],
      },
    };
    stubFetch();

    const element = await PlanPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('You are on <strong>Pro</strong>');
    expect(html).toContain('0 of 1,000 MiB on own Google Drive (Pro)');
  });

  test('displays error alert when plan info fails to load', async () => {
    responses = {};
    stubFetch();

    const element = await PlanPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Could not load plan information');
  });
});
