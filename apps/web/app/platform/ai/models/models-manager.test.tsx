import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModelsManager } from './models-manager';
import type { PlatformAiModel, PlatformAiProvider } from '@/lib/server-api';

const mockModels: PlatformAiModel[] = [
  {
    id: 'model-1',
    provider: 'openai',
    modelId: 'gpt-luna',
    name: 'GPT Luna',
    label: 'Standard',
    creditsPerReply: 1,
    plans: ['pro', 'enterprise'],
    status: 'active',
    isDefault: true,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
  {
    id: 'model-2',
    provider: 'anthropic',
    modelId: 'claude-sonnet-5-5',
    name: 'Claude Sonnet',
    label: 'Advanced',
    creditsPerReply: 5,
    plans: ['pro', 'enterprise'],
    status: 'active',
    isDefault: false,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
  {
    id: 'model-3',
    provider: 'openai',
    modelId: 'gpt-luna-mini',
    name: 'GPT Luna Mini',
    label: 'Standard',
    creditsPerReply: 1,
    plans: ['pro', 'enterprise'],
    status: 'hidden',
    isDefault: false,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
];

const mockProviders: PlatformAiProvider[] = [
  {
    provider: 'openai',
    baseUrl: null,
    status: 'active',
    hasSecret: true,
    maskedSecret: 'sk-••••3f9a',
    lastTestedAt: new Date().toISOString(),
    updatedAt: '2026-10-01T12:00:00Z',
  },
  {
    provider: 'anthropic',
    baseUrl: null,
    status: 'active',
    hasSecret: true,
    maskedSecret: 'sk-ant-••••3f9a',
    lastTestedAt: new Date().toISOString(),
    updatedAt: '2026-10-01T12:00:00Z',
  },
];

describe('ModelsManager (UI-P3)', () => {
  test('renders models catalog with names, provider badges, credits per reply, and default radio', () => {
    const html = renderToStaticMarkup(
      <ModelsManager initialModels={mockModels} initialProviders={mockProviders} currentRole="admin" />,
    );
    expect(html).toContain('AI models and providers');
    expect(html).toContain('What tenants can pick, and what a reply costs');
    expect(html).toContain('GPT Luna');
    expect(html).toContain('Claude Sonnet');
    expect(html).toContain('GPT Luna Mini');
    expect(html).toContain('gpt-luna');
    expect(html).toContain('claude-sonnet-5-5');
    expect(html).toContain('Standard');
    expect(html).toContain('Advanced');
    expect(html).toContain('type="radio"');
    expect(html).toContain('+ Add model');
  });

  test('renders explanatory note regarding price changes and retirement migration', () => {
    const html = renderToStaticMarkup(
      <ModelsManager initialModels={mockModels} initialProviders={mockProviders} currentRole="admin" />,
    );
    expect(html).toContain(
      'A new price applies to replies from now on; past replies keep the price they were charged. Retiring a model moves tenants on it to the default and tells their owners.',
    );
  });

  test('never renders raw secret key, displays masked secret and provider test controls', () => {
    const html = renderToStaticMarkup(
      <ModelsManager initialModels={mockModels} initialProviders={mockProviders} currentRole="admin" />,
    );
    expect(html).toContain('sk-••••3f9a');
    expect(html).toContain('last test passed today');
    expect(html).toContain('Working');
    expect(html).toContain('Replace key');
    expect(html).toContain('Set up');
    expect(html).not.toContain('super-secret-unmasked-token');
  });

  test('read-only view for support staff disables mutating actions', () => {
    const html = renderToStaticMarkup(
      <ModelsManager initialModels={mockModels} initialProviders={mockProviders} currentRole="support" />,
    );
    expect(html).toContain('Read-only access:');
    expect(html).not.toContain('+ Add model');
    expect(html).not.toContain('Replace key');
  });
});
