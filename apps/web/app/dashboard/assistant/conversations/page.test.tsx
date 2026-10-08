import { afterEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/headers', () => ({
  headers: async () => ({ get: () => null }),
}));

import ConversationsPage from './page';

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

const STATS_MOCK = {
  days: 30,
  questions: 312,
  answered_percent: 86,
  helpful_percent: 91,
  content_gaps: 3,
  credits_used: 410,
};

const GAPS_MOCK = {
  gaps: [
    {
      id: 'gap-1',
      query: 'Changing or moving a WhatsApp number',
      count: 9,
      status: 'open',
      flow_id: null,
      flow: null,
      last_seen_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    },
    {
      id: 'gap-2',
      query: 'Setting up custom webhook signatures',
      count: 3,
      status: 'open',
      flow_id: null,
      flow: null,
      last_seen_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    },
  ],
};

const CONVERSATIONS_MOCK = {
  conversations: [
    {
      id: 'convo-1',
      visitor_id: 'vis-1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      question: 'How do I change my WhatsApp number?',
      answered: false,
      rating: null,
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          content: 'How do I change my WhatsApp number?',
          answered: true,
          rating: null,
          feedback: null,
          cited_flow_ids: [],
          model_id: 'gpt-4o-mini',
          tokens_used: 10,
          created_at: new Date().toISOString(),
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'I could not find this in our guides. You can ask our team directly.',
          answered: false,
          rating: null,
          feedback: null,
          cited_flow_ids: [],
          model_id: 'gpt-4o-mini',
          tokens_used: 15,
          created_at: new Date().toISOString(),
        },
      ],
    },
    {
      id: 'convo-2',
      visitor_id: 'vis-2',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      question: 'Where can I find my API key?',
      answered: true,
      rating: 'helpful',
      messages: [
        {
          id: 'msg-3',
          role: 'user',
          content: 'Where can I find my API key?',
          answered: true,
          rating: null,
          feedback: null,
          cited_flow_ids: [],
          model_id: 'gpt-4o-mini',
          tokens_used: 8,
          created_at: new Date().toISOString(),
        },
        {
          id: 'msg-4',
          role: 'assistant',
          content: 'You can find your API keys in the dashboard under Settings > API keys.',
          answered: true,
          rating: 'helpful',
          feedback: null,
          cited_flow_ids: ['flow-1'],
          model_id: 'gpt-4o-mini',
          tokens_used: 22,
          created_at: new Date().toISOString(),
        },
      ],
    },
  ],
};

describe('ConversationsPage (UI-A12)', () => {
  test('an editor sees unauthorized message', async () => {
    responses = {
      '/api/v1/me': { role: 'editor' },
      '/api/v1/plan': { plan: 'pro' },
      '/api/v1/flows': { items: [] },
    };
    stubFetch();

    const element = await ConversationsPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Conversations and content gaps');
    expect(html).toContain('Only owners and admins can view conversations');
  });

  test('a free plan user sees locked page with Pro veil and See plans button', async () => {
    responses = {
      '/api/v1/me': { role: 'owner' },
      '/api/v1/plan': { plan: 'free' },
      '/api/v1/flows': { items: [] },
    };
    stubFetch();

    const element = await ConversationsPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Conversations and content gaps are on Pro');
    expect(html).toContain('See plans');
    expect(html).toContain('/dashboard/plan');
    expect(html).toContain('card-lock is-locked');
    expect(html).toContain('card-veil');
  });

  test('a pro plan owner sees 5 stat cards, export CSV, and content gap list', async () => {
    responses = {
      '/api/v1/me': { role: 'owner' },
      '/api/v1/plan': { plan: 'pro' },
      '/api/v1/flows': { items: [{ public_id: 'flow-1', title: 'WhatsApp Setup' }] },
      '/api/v1/assistant/stats': STATS_MOCK,
      '/api/v1/assistant/gaps': GAPS_MOCK,
      '/api/v1/assistant/conversations': CONVERSATIONS_MOCK,
    };
    stubFetch();

    const element = await ConversationsPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Conversations and content gaps');
    expect(html).toContain('Export CSV');
    expect(html).toContain('312');
    expect(html).toContain('Questions');
    expect(html).toContain('86%');
    expect(html).toContain('Answered from guides');
    expect(html).toContain('91%');
    expect(html).toContain('Rated helpful');
    expect(html).toContain('410');
    expect(html).toContain('Credits used');
    expect(html).toContain('Content gaps (2)');
    expect(html).toContain('Questions (2)');
    expect(html).toContain('Changing or moving a WhatsApp number');
    expect(html).toContain('9 questions');
    expect(html).toContain('Record a guide');
    expect(html).toContain('Add to a guide');
    expect(html).toContain('Dismiss');
  });

  test('handles API load failure gracefully', async () => {
    responses = {
      '/api/v1/me': { role: 'owner' },
      '/api/v1/plan': { plan: 'pro' },
      '/api/v1/flows': { items: [] },
      // /api/v1/assistant/* returns 404
    };
    stubFetch();

    const element = await ConversationsPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Could not load conversations. Refresh the page to try again.');
  });
});
