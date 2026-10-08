import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConversationsManager } from './conversations-manager';

const STATS_MOCK = {
  days: 30,
  questions: 312,
  answered_percent: 86,
  helpful_percent: 91,
  content_gaps: 3,
  credits_used: 410,
};

const GAPS_MOCK = [
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
    count: 1,
    status: 'open',
    flow_id: null,
    flow: null,
    last_seen_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  },
];

const CONVERSATIONS_MOCK = [
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
];

describe('ConversationsManager (UI-A12)', () => {
  test('renders 5 stat cards with accurate values and labels', () => {
    const html = renderToStaticMarkup(
      <ConversationsManager
        initialStats={STATS_MOCK}
        initialGaps={GAPS_MOCK}
        initialConversations={CONVERSATIONS_MOCK}
        guides={[]}
        plan="pro"
      />,
    );

    expect(html).toContain('312');
    expect(html).toContain('Questions');
    expect(html).toContain('86%');
    expect(html).toContain('Answered from guides');
    expect(html).toContain('91%');
    expect(html).toContain('Rated helpful');
    expect(html).toContain('3');
    expect(html).toContain('Content gaps');
    expect(html).toContain('410');
    expect(html).toContain('Credits used');
  });

  test('renders Export CSV link with download attribute', () => {
    const html = renderToStaticMarkup(
      <ConversationsManager
        initialStats={STATS_MOCK}
        initialGaps={GAPS_MOCK}
        initialConversations={CONVERSATIONS_MOCK}
        guides={[]}
        plan="pro"
      />,
    );

    expect(html).toContain('href="/api/v1/assistant/export?days=30"');
    expect(html).toContain('download="assistant-conversations.csv"');
    expect(html).toContain('Export CSV');
  });

  test('renders content gap rows with sparkle icon, badges and 3 action buttons', () => {
    const html = renderToStaticMarkup(
      <ConversationsManager
        initialStats={STATS_MOCK}
        initialGaps={GAPS_MOCK}
        initialConversations={CONVERSATIONS_MOCK}
        guides={[]}
        plan="pro"
      />,
    );

    expect(html).toContain('Changing or moving a WhatsApp number');
    expect(html).toContain('9 questions');
    expect(html).toContain('1 question');
    expect(html).toContain('Record a guide');
    expect(html).toContain('Add to a guide');
    expect(html).toContain('Dismiss');
    expect(html).toContain('Footnote:');
    expect(html).toContain('copies a prompt for your AI agent');
  });

  test('renders empty state for gaps when gaps list is empty', () => {
    const html = renderToStaticMarkup(
      <ConversationsManager
        initialStats={STATS_MOCK}
        initialGaps={[]}
        initialConversations={CONVERSATIONS_MOCK}
        guides={[]}
        plan="pro"
      />,
    );

    expect(html).toContain('No content gaps');
    expect(html).not.toContain('Record a guide');
  });

  test('renders empty state for questions when conversations list is empty', () => {
    const html = renderToStaticMarkup(
      <ConversationsManager
        initialStats={STATS_MOCK}
        initialGaps={GAPS_MOCK}
        initialConversations={[]}
        guides={[]}
        plan="pro"
      />,
    );

    // Initial tab is gaps; if conversations is empty, the tab header shows Questions (0)
    expect(html).toContain('Questions (0)');
  });
});
