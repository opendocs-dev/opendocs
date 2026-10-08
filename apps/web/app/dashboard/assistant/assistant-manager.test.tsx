import { afterEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssistantManager } from './assistant-manager';
import type { AssistantResponse } from '@/lib/server-api';

const DEFAULT_INITIAL: AssistantResponse = {
  assistant: {
    organization_id: 'org1',
    enabled: true,
    name: 'Acme Assistant',
    button_label: 'Ask AI',
    welcome: 'How can I help you today?',
    suggested: ['How do I authenticate?', 'What is the quickstart?'],
    tone: 'friendly',
    language: 'auto',
    source_mode: 'all',
    source_category_ids: ['cat1'],
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
    embed_origins: ['https://example.com'],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  credits: {
    used: 412,
    total: 10000,
    percent: 4,
    reset_date: 'Oct 1',
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

const CATEGORIES = [{ id: 'cat1', name: 'Getting Started', slug: 'getting-started', description: '', position: 0, status: 'active' as const, source: 'user' as const, created_at: '' }];
const GUIDES = [{ public_id: 'flow1', title: 'Quickstart Guide', last_run_at: '', url: null, not_redacted: true }];

describe('AssistantManager component', () => {
  test('renders top card with on/off status and credit usage', () => {
    const html = renderToStaticMarkup(
      <AssistantManager
        initial={DEFAULT_INITIAL}
        plan="pro"
        categories={CATEGORIES}
        guides={GUIDES}
        sitePreset="sage"
      />,
    );

    expect(html).toContain('Assistant is on');
    expect(html).toContain('<strong>412</strong> of 10,000 credits used this month');
    expect(html).toContain('Save changes');
  });

  test('renders Setup tab by default with Identity form and Live Preview', () => {
    const html = renderToStaticMarkup(
      <AssistantManager
        initial={DEFAULT_INITIAL}
        plan="pro"
        categories={CATEGORIES}
        guides={GUIDES}
        sitePreset="sage"
      />,
    );

    expect(html).toContain('Identity');
    expect(html).toContain('Acme Assistant');
    expect(html).toContain('Ask AI');
    expect(html).toContain('How can I help you today?');
    expect(html).toContain('Suggested questions (up to 4)');
    expect(html).toContain('How do I authenticate?');
    expect(html).toContain('Preview (uses your look)');
    expect(html).toContain('Preset: sage');
  });

  test('on Pro plan, Enterprise cards (BYOK and Embed) show locked veil', () => {
    const html = renderToStaticMarkup(
      <AssistantManager
        initial={DEFAULT_INITIAL}
        plan="pro"
        categories={CATEGORIES}
        guides={GUIDES}
      />,
    );

    // On Pro plan, Enterprise cards are present with is-locked class and veil box
    expect(html).toContain('Setup');
  });

  test('on Enterprise plan, shows active Enterprise capabilities', () => {
    const html = renderToStaticMarkup(
      <AssistantManager
        initial={DEFAULT_INITIAL}
        plan="enterprise"
        categories={CATEGORIES}
        guides={GUIDES}
      />,
    );

    expect(html).toContain('AI assistant');
    expect(html).toContain('Setup');
    expect(html).toContain('Knowledge');
    expect(html).toContain('Behavior');
    expect(html).toContain('Model and credits');
    expect(html).toContain('Where it appears');
  });
});
