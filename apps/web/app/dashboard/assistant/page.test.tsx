import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/headers', () => ({
  headers: async () => ({ get: () => null }),
}));

import AssistantPage from './page';

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

const DEFAULT_ASSISTANT = {
  assistant: {
    organization_id: 'org1',
    enabled: false,
    name: 'Acme Assistant',
    button_label: 'Ask AI',
    welcome: 'How can I help you today?',
    suggested: ['How do I authenticate?', 'What is the quickstart?'],
    tone: 'friendly',
    language: 'auto',
    source_mode: 'all',
    source_category_ids: [],
    excluded_flow_ids: [],
    no_match_mode: 'contact',
    contact_target: 'support@example.com',
    off_topic_refusal: true,
    show_sources: true,
    hourly_per_visitor: 30,
    daily_cap: 500,
    retention_days: 30,
    mask_pii: true,
    position: 'bottom-right',
    model_id: 'gpt-4o-mini',
    byo_enabled: false,
    byo_provider: 'anthropic',
    byo_base_url: null,
    byo_model: null,
    byo_secret_set: false,
    byo_secret_masked: null,
    byo_fallback_credits: false,
    embed_origins: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  credits: {
    used: 412,
    total: 10000,
    percent: 4,
    reset_date: 'Nov 1',
  },
  models: [
    {
      id: 'm1',
      model_id: 'gpt-4o-mini',
      name: 'GPT-4o Mini',
      provider: 'openai',
      label: 'Standard',
      credits_per_reply: 1,
      is_default: true,
    },
    {
      id: 'm2',
      model_id: 'claude-3-5-sonnet',
      name: 'Claude 3.5 Sonnet',
      provider: 'anthropic',
      label: 'Advanced',
      credits_per_reply: 5,
      is_default: false,
    },
  ],
  replies_by_model: [
    {
      model_id: 'gpt-4o-mini',
      model_name: 'GPT-4o Mini',
      replies_count: 120,
      credits_used: 120,
    },
  ],
  index_status: {
    indexed_count: 10,
    total_count: 10,
    last_indexed_at: new Date().toISOString(),
  },
};

const SITE = {
  address: { slug: 'acme', host: 'acme.opendocs.xxx' },
  site_title: 'Acme',
  preset: 'sage',
};

describe('AssistantPage (UI-A11)', () => {
  test('an editor sees unauthorized message', async () => {
    responses = {
      '/api/v1/me': { role: 'editor' },
      '/api/v1/plan': { plan: 'pro' },
      '/api/v1/site': SITE,
      '/api/v1/categories': { categories: [] },
      '/api/v1/flows': { items: [] },
    };
    stubFetch();

    const element = await AssistantPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('AI assistant');
    expect(html).toContain('Only owners and admins can manage the AI assistant');
  });

  test('a free plan user sees locked page with Pro veil and See plans button', async () => {
    responses = {
      '/api/v1/me': { role: 'owner' },
      '/api/v1/plan': { plan: 'free' },
      '/api/v1/site': SITE,
      '/api/v1/categories': { categories: [] },
      '/api/v1/flows': { items: [] },
    };
    stubFetch();

    const element = await AssistantPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('The AI assistant is on Pro');
    expect(html).toContain('Let readers ask questions and get answers from your guides.');
    expect(html).toContain('See plans');
    expect(html).toContain('/dashboard/plan');
    expect(html).toContain('card-lock is-locked');
    expect(html).toContain('card-veil');
  });

  test('a pro plan owner sees the active assistant manager with 5 tabs and identity form', async () => {
    responses = {
      '/api/v1/me': { role: 'owner' },
      '/api/v1/plan': { plan: 'pro' },
      '/api/v1/site': SITE,
      '/api/v1/categories': { categories: [{ id: 'cat1', name: 'Getting Started' }] },
      '/api/v1/flows': { items: [{ public_id: 'flow1', title: 'Quickstart' }] },
      '/api/v1/assistant': DEFAULT_ASSISTANT,
    };
    stubFetch();

    const element = await AssistantPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('AI assistant');
    expect(html).toContain('Configure how your assistant answers readers');
    expect(html).toContain('Save changes');
    expect(html).toContain('Assistant is off');
    expect(html).toContain('412');
    expect(html).toContain('10,000');
    expect(html).toContain('Setup');
    expect(html).toContain('Knowledge');
    expect(html).toContain('Behavior');
    expect(html).toContain('Model and credits');
    expect(html).toContain('Where it appears');
    expect(html).toContain('Acme Assistant');
    expect(html).toContain('Ask AI');
    expect(html).toContain('How can I help you today?');
    expect(html).toContain('Preview (uses your look)');
  });
});
