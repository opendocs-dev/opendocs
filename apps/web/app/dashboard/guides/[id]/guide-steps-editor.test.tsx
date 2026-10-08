import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

const realNavigation = await import('next/navigation');
mock.module('next/navigation', () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

import type { AdminStep, FlowItem, FlowRun } from '@/lib/server-api';
import { GuideStepsEditor, isStepChanged, saveChangedSteps } from './guide-steps-editor';
import { GuideDetailView } from './guide-detail-view';

const MOCK_GUIDE: FlowItem = {
  public_id: 'guide_123',
  title: 'Test Guide',
  last_run_at: '2026-10-02T00:00:00Z',
  url: 'https://opendocs.example/d/guide_123',
  not_redacted: true,
  visibility: 'published',
};

const MOCK_STEPS: AdminStep[] = [
  {
    id: 'step_1',
    order: 1,
    action: 'click',
    instruction: 'Click the **Settings** menu',
    title: 'Open Settings',
    alt: 'Settings page screenshot',
    page_url: 'https://example.com/settings',
    selector: '#settings-btn',
    box: { x: 10, y: 20, w: 100, h: 40 },
    image: { url: '/i/img1', width: 1280, height: 800 },
    masked_count: 2,
  },
  {
    id: 'step_2',
    order: 2,
    action: 'click',
    instruction: 'Click **Save Changes**',
    title: 'Save Form',
    alt: 'Save button screenshot',
    page_url: 'https://example.com/form',
    selector: '#save-btn',
    box: null,
    image: { url: null, width: null, height: null },
  },
];

const MOCK_RUNS: FlowRun[] = [
  {
    id: 'run_1',
    started_at: '2026-09-30T13:58:00Z',
    compiled_at: '2026-09-30T13:59:00Z',
    status: 'compiled',
    step_count: 8,
    cli_version: '0.9.2',
    is_current: true,
  },
  {
    id: 'run_2',
    started_at: '2026-09-30T13:41:00Z',
    compiled_at: null,
    status: 'recording',
    step_count: 5,
    cli_version: null,
    is_current: false,
  },
];

describe('GuideStepsEditor (C19 AC-05 & UI-A16)', () => {
  test('renders step count, steps list with ordering controls, and editor pane for first step', () => {
    const html = renderToStaticMarkup(
      <GuideStepsEditor guide={MOCK_GUIDE} initialSteps={MOCK_STEPS} runs={MOCK_RUNS} />,
    );

    // Step count
    expect(html).toContain('2 steps');

    // Steps list items
    expect(html).toContain('1. Open Settings');
    expect(html).toContain('2. Save Form');

    // Subtitle has ** stripped (UI-A16 Finding 4)
    expect(html).toContain('Click the Settings menu');
    expect(html).toContain('Click Save Changes');

    // Masked field count in row (UI-A16 Finding 3)
    expect(html).toContain('2 fields masked');

    // Move buttons with larger touch targets (UI-A16 Finding 14)
    expect(html).toContain('aria-label="Move step 1 up"');
    expect(html).toContain('aria-label="Move step 1 down"');
    expect(html).toContain('aria-label="Move step 2 up"');
    expect(html).toContain('aria-label="Move step 2 down"');

    // Highlight badge
    expect(html).toContain('Highlight');

    // History card on Steps tab (UI-A16 Finding 1 & 8)
    expect(html).toContain('History');
    expect(html).toContain('Recorded via CLI 0.9.2');
    expect(html).toContain('8 steps');
    expect(html).toContain('published');
    expect(html).toContain('not published');

    // Edit step form heading (UI-A16 Finding 11: "Edit step", not "Edit step 1")
    expect(html).toContain('Edit step');
    expect(html).not.toContain('Edit step 1');

    // Form inputs and instructions
    expect(html).toContain('Open Settings');
    expect(html).toContain('Click the **Settings** menu');
    expect(html).toContain('Settings page screenshot');

    // Helper text removed from title/alt (UI-A16 Finding 10)
    expect(html).not.toContain('At most 120 characters');
    expect(html).not.toContain('At most 300 characters');

    // Switch toggle control (UI-A16 Finding 9)
    expect(html).toContain('class="switch"');
    expect(html).toContain('Show the highlight box');

    // Masked fields and highlight info in editor (UI-A16 Finding 3)
    expect(html).toContain('Highlight on <b>Settings</b>');

    // Shown / Hidden toggle in step list rows (UI-A16 Finding 2)
    expect(html).toContain('aria-label="Show step 1"');
    expect(html).toContain('aria-label="Show step 2"');
    expect(html).toContain('Shown');

    // Action buttons & Re-record (UI-A16 Finding 5: per-step Save replaced by header Save)
    expect(html).not.toContain('Save step');
    expect(html).toContain('Re-record this step');
    expect(html).toContain('Re-record copies a prompt for your AI agent to redo only this step.');
    expect(html).toContain('Delete step');
  });

  test('renders hidden step with Hidden label and eye-off state (UI-A16 Finding 2)', () => {
    const stepsWithHidden: AdminStep[] = [
      { ...MOCK_STEPS[0], hidden: true },
      MOCK_STEPS[1],
    ];
    const html = renderToStaticMarkup(
      <GuideStepsEditor guide={MOCK_GUIDE} initialSteps={stepsWithHidden} />,
    );

    expect(html).toContain('(Hidden)');
    expect(html).toContain('Hidden');
    expect(html).toContain('aria-pressed="false"');
  });

  test('renders placeholder state when step has no image (UI-A16 Finding 7)', () => {
    // When step 2 (no image) is rendered in editor
    const stepWithoutImage: AdminStep[] = [MOCK_STEPS[1]];
    const html = renderToStaticMarkup(
      <GuideStepsEditor guide={MOCK_GUIDE} initialSteps={stepWithoutImage} />,
    );

    expect(html).toContain('No screenshot available for this step');
  });

  test('renders empty state when guide has no steps', () => {
    const html = renderToStaticMarkup(<GuideStepsEditor guide={MOCK_GUIDE} initialSteps={[]} />);

    expect(html).toContain('0 steps');
    expect(html).toContain('No steps in this guide.');
    expect(html).toContain('Select a step on the left to edit.');
  });
});

describe('GuideDetailView (UI-A16)', () => {
  test('renders header with subtitle and underline tabs (Finding 1, 6, 12)', () => {
    const html = renderToStaticMarkup(
      <GuideDetailView
        guide={MOCK_GUIDE}
        initialSteps={MOCK_STEPS}
        categories={[]}
        siteHost="site.example"
        initialRuns={MOCK_RUNS}
      />,
    );

    // Header title and subtitle (Finding 6)
    expect(html).toContain('Test Guide');
    expect(html).toContain('Steps, settings and history');

    // Underline tabs (Finding 1 & 12)
    expect(html).toContain('class="adm-tabs"');
    expect(html).toContain('Steps');
    expect(html).toContain('Settings');
    expect(html).toContain('History');
  });

  test('renders History tab panel when history tab is active (Finding 1)', () => {
    const html = renderToStaticMarkup(
      <GuideDetailView
        guide={MOCK_GUIDE}
        initialSteps={MOCK_STEPS}
        categories={[]}
        siteHost="site.example"
        defaultTab="history"
        initialRuns={MOCK_RUNS}
      />,
    );

    expect(html).toContain('Recording history');
    expect(html).toContain('Recordings and compilations behind this guide.');
    expect(html).toContain('Recorded via CLI 0.9.2');
  });

  test('header contains Save steps button on Steps tab, disabled when nothing changed (Finding 5)', () => {
    const html = renderToStaticMarkup(
      <GuideDetailView
        guide={MOCK_GUIDE}
        initialSteps={MOCK_STEPS}
        categories={[]}
        siteHost="site.example"
        defaultTab="steps"
        initialRuns={MOCK_RUNS}
      />,
    );

    // Header buttons (Finding 5)
    expect(html).toContain('Preview');
    expect(html).toContain('Save steps');
    // Button is disabled when no changes were made
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Save steps/);
  });

  test('header switches to Save changes on Settings tab (Finding 5)', () => {
    const html = renderToStaticMarkup(
      <GuideDetailView
        guide={MOCK_GUIDE}
        initialSteps={MOCK_STEPS}
        categories={[]}
        siteHost="site.example"
        defaultTab="settings"
        initialRuns={MOCK_RUNS}
      />,
    );

    expect(html).toContain('Preview');
    expect(html).toContain('Save changes');
    expect(html).not.toContain('Save steps');
  });
});

describe('isStepChanged & saveChangedSteps (UI-A16 Finding 2 & 5)', () => {
  test('isStepChanged detects changes in title, instruction, alt, box, and hidden', () => {
    const base = MOCK_STEPS[0];
    expect(isStepChanged(base, base)).toBe(false);
    expect(isStepChanged({ ...base, title: 'New Title' }, base)).toBe(true);
    expect(isStepChanged({ ...base, instruction: 'New Instruction' }, base)).toBe(true);
    expect(isStepChanged({ ...base, alt: 'New Alt' }, base)).toBe(true);
    expect(isStepChanged({ ...base, hidden: true }, base)).toBe(true);
    expect(isStepChanged({ ...base, box: null }, base)).toBe(true);
    expect(isStepChanged({ ...base, box: { x: 99, y: 20, w: 100, h: 40 } }, base)).toBe(true);
  });

  test('saveChangedSteps sends requests in order for changed steps only and updates saved state', async () => {
    const requests: { url: string; body: unknown }[] = [];
    const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ ok: true, step: { id: 'step_1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const modifiedSteps: AdminStep[] = [
      { ...MOCK_STEPS[0], title: 'Modified Title', hidden: true },
      { ...MOCK_STEPS[1], instruction: 'Modified Instruction' },
    ];

    const result = await saveChangedSteps('guide_123', modifiedSteps, MOCK_STEPS, mockFetch);
    expect(result.ok).toBe(true);
    expect(result.savedIds).toEqual(['step_1', 'step_2']);
    expect(requests).toHaveLength(2);
    expect(requests[0].url).toBe('/api/v1/flows/guide_123/steps/step_1');
    expect(requests[0].body).toMatchObject({ title: 'Modified Title', hidden: true });
    expect(requests[1].url).toBe('/api/v1/flows/guide_123/steps/step_2');
    expect(requests[1].body).toMatchObject({ instruction: 'Modified Instruction', hidden: false });
  });

  test('saveChangedSteps stops on first failure and keeps remaining unsaved state', async () => {
    const requests: string[] = [];
    const mockFetch = (async (url: string | URL | Request) => {
      const urlStr = String(url);
      requests.push(urlStr);
      if (urlStr.includes('step_1')) {
        return new Response(JSON.stringify({ ok: true, step: { id: 'step_1' } }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { message: 'Validation failed on step 2' } }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const step3: AdminStep = {
      ...MOCK_STEPS[1],
      id: 'step_3',
      order: 3,
      instruction: 'Step 3 Instruction',
    };

    const modifiedSteps: AdminStep[] = [
      { ...MOCK_STEPS[0], title: 'Changed 1' },
      { ...MOCK_STEPS[1], title: 'Changed 2' },
      { ...step3, title: 'Changed 3' },
    ];

    const initial = [MOCK_STEPS[0], MOCK_STEPS[1], step3];
    const result = await saveChangedSteps('guide_123', modifiedSteps, initial, mockFetch);

    expect(result.ok).toBe(false);
    expect(result.savedIds).toEqual(['step_1']);
    expect(result.failedId).toBe('step_2');
    expect(result.error).toBe('Validation failed on step 2');
    // Step 3 was never called because it stopped immediately on step 2!
    expect(requests).toHaveLength(2);
    expect(requests).toEqual([
      '/api/v1/flows/guide_123/steps/step_1',
      '/api/v1/flows/guide_123/steps/step_2',
    ]);
  });
});
