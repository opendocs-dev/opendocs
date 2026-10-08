import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { SiteAskAi, getContactHref } from './ask-ai-panel';

describe('SiteAskAi Component (UI-R6, AC-18)', () => {
  const baseAssistant = {
    enabled: true,
    name: 'Acme Assistant',
    button_label: 'Ask AI',
    welcome: 'Hi! Ask me anything about Acme. I answer from our published guides and link the steps.',
    suggested: [
      'How do I create a template?',
      'Top up my balance',
      'Where is my invoice?',
    ],
    position: 'bottom-right' as const,
    show_sources: true,
    no_match_mode: 'contact' as const,
    contact_target: 'support@example.com',
  };

  test('renders the floating launcher button when closed', () => {
    const html = renderToStaticMarkup(
      <SiteAskAi
        siteTitle="Acme"
        assistant={baseAssistant}
        initialOpen={false}
      />,
    );

    expect(html).toContain('tenant-ask-ai-floating');
    expect(html).toContain('Ask AI');
    expect(html).toContain('data-position="bottom-right"');
    expect(html).not.toContain('role="dialog"');
  });

  test('supports configurable launcher position (bottom-left)', () => {
    const html = renderToStaticMarkup(
      <SiteAskAi
        siteTitle="Acme"
        assistant={{ ...baseAssistant, position: 'bottom-left' }}
        initialOpen={false}
      />,
    );

    expect(html).toContain('data-position="bottom-left"');
  });

  test('renders dialog with header, welcome bubble, chips, input, and footer when opened', () => {
    const html = renderToStaticMarkup(
      <SiteAskAi
        siteTitle="Acme"
        assistant={baseAssistant}
        initialOpen={true}
      />,
    );

    // Accessibility attributes
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Ask AI assistant"');
    expect(html).toContain('aria-modal="true"');

    // Header
    expect(html).toContain('Acme Assistant');
    expect(html).toContain('AI answers from our guides');
    expect(html).toContain('aria-label="Close assistant"');

    // Welcome bubble
    expect(html).toContain('Hi! Ask me anything about Acme. I answer from our published guides and link the steps.');

    // Suggested question chips
    expect(html).toContain('How do I create a template?');
    expect(html).toContain('Top up my balance');
    expect(html).toContain('Where is my invoice?');

    // Input form
    expect(html).toContain('placeholder="Ask a question..."');
    expect(html).toContain('Send');

    // Footer
    expect(html).toContain('AI can make mistakes. Check the linked guide.');
  });

  test('State 1 (Answered): renders answer bubble with source cards and helpful buttons', () => {
    const html = renderToStaticMarkup(
      <SiteAskAi
        siteTitle="Acme"
        assistant={baseAssistant}
        initialOpen={true}
        initialMessages={[
          {
            id: 'msg-1',
            role: 'user',
            content: 'How do I create a template?',
          },
          {
            id: 'msg-2',
            role: 'assistant',
            content: 'To create a WhatsApp message template, follow these steps:\n1. Open messaging\n2. Click Create Template',
            status: 'answered',
            sources: [
              {
                id: 'src-1',
                slug: 'create-whatsapp-template',
                title: 'Create a WhatsApp message template',
                step_range: 'steps 2 to 6',
                start_step: 2,
                end_step: 6,
              },
            ],
          },
        ]}
      />,
    );

    // User bubble
    expect(html).toContain('tenant-ask-ai-user-bubble');
    expect(html).toContain('How do I create a template?');

    // Bot bubble
    expect(html).toContain('tenant-ask-ai-bot-bubble');
    expect(html).toContain('To create a WhatsApp message template');

    // Source card
    expect(html).toContain('Create a WhatsApp message template');
    expect(html).toContain('steps 2 to 6');
    expect(html).toContain('/g/create-whatsapp-template#step-2');

    // Helpful buttons
    expect(html).toContain('Helpful?');
    expect(html).toContain('Yes');
    expect(html).toContain('No');
  });

  test('State 2 (No match): renders fallback message and contact options', () => {
    const html = renderToStaticMarkup(
      <SiteAskAi
        siteTitle="Acme"
        assistant={baseAssistant}
        initialOpen={true}
        initialMessages={[
          {
            id: 'msg-1',
            role: 'user',
            content: 'How do I build a spaceship?',
          },
          {
            id: 'msg-2',
            role: 'assistant',
            content: 'I could not find this in our guides. You can ask our team directly.',
            status: 'no_match',
            question: 'How do I build a spaceship?',
          },
        ]}
      />,
    );

    // No match text
    expect(html).toContain('I could not find this in our guides. You can ask our team directly.');

    // Contact actions
    expect(html).toContain('Contact support');
    expect(html).toContain('mailto:support@example.com');
    expect(html).toContain('Email this question');
    expect(html).toContain('How%20do%20I%20build%20a%20spaceship');
  });

  test('State 3 (Typing): renders typing indicator', () => {
    const html = renderToStaticMarkup(
      <SiteAskAi
        siteTitle="Acme"
        assistant={baseAssistant}
        initialOpen={true}
        initialLoading={true}
      />,
    );

    expect(html).toContain('tenant-ask-ai-typing');
    expect(html).toContain('Thinking');
    expect(html).toContain('tenant-ask-ai-dot');
  });

  test('Limit state: shows the friendly limit message without contact buttons', () => {
    const html = renderToStaticMarkup(
      <SiteAskAi
        siteTitle="Acme"
        assistant={baseAssistant}
        initialOpen={true}
        initialMessages={[
          {
            id: 'msg-1',
            role: 'user',
            content: 'Help me please',
          },
          {
            id: 'msg-2',
            role: 'assistant',
            content: 'You have reached the question limit for this chat today.',
            status: 'limit',
          },
        ]}
      />,
    );

    expect(html).toContain('You have reached the question limit for this chat today.');
    expect(html).not.toContain('Contact support');
  });

  describe('getContactHref (UI-R6 review finding 5)', () => {
    test('returns null for javascript: and data: URLs', () => {
      expect(getContactHref('javascript:alert(1)')).toBeNull();
      expect(getContactHref('javascript:void(0)')).toBeNull();
      expect(getContactHref('data:text/html,<script>alert(1)</script>')).toBeNull();
      expect(getContactHref('data:text/plain;base64,SGVsbG8=')).toBeNull();
    });

    test('returns null for other non-email/non-http schemes and arbitrary text', () => {
      expect(getContactHref('ftp://example.com/file')).toBeNull();
      expect(getContactHref('file:///etc/passwd')).toBeNull();
      expect(getContactHref('just plain text')).toBeNull();
      expect(getContactHref('')).toBeNull();
      expect(getContactHref('   ')).toBeNull();
      expect(getContactHref(null)).toBeNull();
      expect(getContactHref(undefined)).toBeNull();
    });

    test('returns mailto: for valid email addresses', () => {
      expect(getContactHref('support@example.com')).toBe('mailto:support@example.com');
      expect(getContactHref('mailto:support@example.com')).toBe('mailto:support@example.com');
      expect(getContactHref('user+tag@example.co.uk')).toBe('mailto:user+tag@example.co.uk');
    });

    test('returns target for valid https and http URLs', () => {
      expect(getContactHref('https://example.com/support')).toBe('https://example.com/support');
      expect(getContactHref('http://help.example.com')).toBe('http://help.example.com');
    });

    test('renders no link when contact_target is javascript: or data:', () => {
      const html = renderToStaticMarkup(
        <SiteAskAi
          siteTitle="Acme"
          assistant={{ ...baseAssistant, contact_target: 'javascript:alert(1)' }}
          initialOpen={true}
          initialMessages={[
            {
              id: 'msg-1',
              role: 'assistant',
              content: 'No guide match',
              status: 'no_match',
            },
          ]}
        />,
      );

      // Contact support link is NOT rendered
      expect(html).not.toContain('Contact support');
      expect(html).not.toContain('javascript:alert(1)');
    });
  });

  describe('Focus handling (UI-R6 review finding 6)', () => {
    test('input is readOnly and aria-busy while loading, never disabled', () => {
      const html = renderToStaticMarkup(
        <SiteAskAi
          siteTitle="Acme"
          assistant={baseAssistant}
          initialOpen={true}
          initialLoading={true}
        />,
      );

      expect(html).toContain('readOnly=""');
      expect(html).toContain('aria-busy="true"');
      // The text input itself must have readOnly and aria-busy, not disabled
      expect(html).toContain('<input type="text" class="tenant-ask-ai-input" placeholder="Ask a question..." aria-label="Ask a question" readOnly="" aria-busy="true" value=""/>');
    });

    test('launcher button is rendered always (hidden when open)', () => {
      const html = renderToStaticMarkup(
        <SiteAskAi
          siteTitle="Acme"
          assistant={baseAssistant}
          initialOpen={true}
        />,
      );

      // Launcher exists in the DOM even when panel is open
      expect(html).toContain('tenant-ask-ai-floating');
      expect(html).toContain('tenant-ask-ai-floating-hidden');
      expect(html).toContain('display:none');
    });
  });
});
