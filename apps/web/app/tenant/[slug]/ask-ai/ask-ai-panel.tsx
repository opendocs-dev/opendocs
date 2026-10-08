'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import type { ChatSource, PublicAssistantConfig } from '@/lib/tenant-api';
import { sendChatMessage, voteChatMessage } from '@/lib/chat-client';

export type TenantAskAiProps = {
  slug: string;
  siteTitle: string;
  logoUrl?: string | null;
  assistant?: PublicAssistantConfig | null;
  initialOpen?: boolean;
  initialMessages?: DisplayMessage[];
  initialLoading?: boolean;
};

export type DisplayMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: 'answered' | 'no_match' | 'out_of_credits';
  sources?: ChatSource[];
  voted?: 'helpful' | 'unhelpful';
  question?: string;
};

export function getContactHref(target?: string | null): string | null {
  if (!target) return null;
  const trimmed = target.trim();
  if (!trimmed) return null;

  const emailCandidate = trimmed.startsWith('mailto:') ? trimmed.slice(7) : trimmed;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (emailRegex.test(emailCandidate)) {
    return `mailto:${emailCandidate}`;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return trimmed;
    }
  } catch {
    // invalid URL
  }

  return null;
}

function getOrCreateVisitorId(): string {
  if (typeof window === 'undefined') return 'visitor-ssr';
  const storageKey = 'opendocs_visitor_id';
  try {
    let id = localStorage.getItem(storageKey);
    if (!id) {
      id = 'v-' + Math.random().toString(36).substring(2, 15) + '-' + Date.now().toString(36);
      localStorage.setItem(storageKey, id);
    }
    return id;
  } catch {
    return 'v-temp-' + Math.random().toString(36).substring(2, 9);
  }
}

export function TenantAskAi({
  slug,
  siteTitle,
  logoUrl,
  assistant,
  initialOpen = false,
  initialMessages = [],
  initialLoading = false,
}: TenantAskAiProps) {
  const [open, setOpen] = useState(initialOpen);
  const [messages, setMessages] = useState<DisplayMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(initialLoading);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);

  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevOpenRef = useRef(open);

  const position = assistant?.position === 'bottom-left' ? 'bottom-left' : 'bottom-right';
  const name = assistant?.name || `${siteTitle} Assistant`;
  const buttonLabel = assistant?.button_label || 'Ask AI';
  const welcome =
    assistant?.welcome ||
    `Hi! Ask me anything about ${siteTitle}. I answer from our published guides and link the steps.`;
  const suggested =
    assistant?.suggested && assistant.suggested.length > 0
      ? assistant.suggested
      : [
          'How do I create a template?',
          'Top up my balance',
          'Where is my invoice?',
        ];
  const initial = siteTitle ? siteTitle.charAt(0).toUpperCase() : 'A';
  const contactTarget = assistant?.contact_target || '';
  const noMatchMode = assistant?.no_match_mode || 'contact';

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, scrollToBottom]);

  // Restore focus to launcher on close
  useEffect(() => {
    if (prevOpenRef.current && !open) {
      launcherRef.current?.focus();
    }
    prevOpenRef.current = open;
  }, [open]);

  // Handle URL hash and custom events
  useEffect(() => {
    const handleHash = () => {
      if (typeof window !== 'undefined' && window.location.hash === '#ask-ai') {
        setOpen(true);
      }
    };

    const handleCustomOpen = (e: Event) => {
      setOpen(true);
      const customEvent = e as CustomEvent<{ query?: string }>;
      if (customEvent.detail?.query) {
        setInput(customEvent.detail.query);
      }
    };

    handleHash();
    window.addEventListener('hashchange', handleHash);
    window.addEventListener('open-ask-ai', handleCustomOpen);

    // Global click listener for any <a href="#ask-ai">
    const handleDocumentClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('a[href="#ask-ai"]');
      if (target) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('click', handleDocumentClick);

    return () => {
      window.removeEventListener('hashchange', handleHash);
      window.removeEventListener('open-ask-ai', handleCustomOpen);
      document.removeEventListener('click', handleDocumentClick);
    };
  }, []);

  // Keyboard accessibility: Escape to close and focus trap
  useEffect(() => {
    if (!open) return;

    // Focus input when opened
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }

      if (e.key === 'Tab' && panelRef.current) {
        const focusableElements = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        const active = document.activeElement;

        if (e.shiftKey) {
          if (
            active === firstElement ||
            active === document.body ||
            !active ||
            !panelRef.current.contains(active)
          ) {
            lastElement?.focus();
            e.preventDefault();
          }
        } else {
          if (
            active === lastElement ||
            active === document.body ||
            !active ||
            !panelRef.current.contains(active)
          ) {
            firstElement?.focus();
            e.preventDefault();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleSend = async (messageText: string) => {
    const trimmed = messageText.trim();
    if (!trimmed || loading) return;

    const userMsgId = 'user-' + Date.now();
    const newMessages: DisplayMessage[] = [
      ...messages,
      { id: userMsgId, role: 'user', content: trimmed },
    ];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    const visitorId = getOrCreateVisitorId();
    const result = await sendChatMessage(slug, trimmed, visitorId, conversationId);

    setLoading(false);

    if (result) {
      if (result.conversation_id) {
        setConversationId(result.conversation_id);
      }
      setMessages((prev) => [
        ...prev,
        {
          id: result.message_id || 'bot-' + Date.now(),
          role: 'assistant',
          content: result.content,
          status: result.status,
          sources: assistant?.show_sources === false ? [] : result.sources,
          question: trimmed,
        },
      ]);
    } else {
      setMessages((prev) => [
        ...prev,
        {
          id: 'error-' + Date.now(),
          role: 'assistant',
          content:
            'The AI assistant is temporarily unavailable. You can ask our team directly.',
          status: 'no_match',
          question: trimmed,
        },
      ]);
    }
  };

  const handleVote = async (messageId: string, helpful: boolean) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId ? { ...m, voted: helpful ? 'helpful' : 'unhelpful' } : m,
      ),
    );
    const visitorId = getOrCreateVisitorId();
    await voteChatMessage(slug, messageId, helpful, undefined, visitorId);
  };

  const contactHref = getContactHref(contactTarget);

  const getEmailQuestionHref = (question?: string) => {
    const email = contactHref?.startsWith('mailto:') ? contactHref.slice(7) : 'support@example.com';
    const subject = encodeURIComponent(`Question about ${siteTitle}: ${question || ''}`);
    return `mailto:${email}?subject=${subject}`;
  };

  return (
    <>
      {/* Floating launcher button (rendered always, hidden visually when open) */}
      <button
        ref={launcherRef}
        type="button"
        className={`tenant-ask-ai-floating${open ? ' tenant-ask-ai-floating-hidden' : ''}`}
        style={open ? { display: 'none' } : undefined}
        data-position={position}
        onClick={() => setOpen(true)}
        aria-label={`Open ${buttonLabel}`}
        aria-expanded={open}
      >
        <span className="tenant-ask-ai-floating-icon" aria-hidden="true">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </span>
        <span>{buttonLabel}</span>
      </button>

      {/* Backdrop for mobile */}
      {open && (
        <div
          className="tenant-ask-ai-backdrop"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Chat dialog panel */}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Ask AI assistant"
          className="tenant-ask-ai-panel"
          data-position={position}
        >
          {/* Header */}
          <div className="tenant-ask-ai-header">
            <div className="tenant-ask-ai-header-brand">
              <div className="tenant-ask-ai-logo-tile" aria-hidden="true">
                {logoUrl ? <img src={logoUrl} alt="" /> : initial}
              </div>
              <div>
                <div className="tenant-ask-ai-header-title">{name}</div>
                <div className="tenant-ask-ai-header-subtitle">AI answers from our guides</div>
              </div>
            </div>
            <button
              type="button"
              className="tenant-ask-ai-close-btn"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Messages Body */}
          <div className="tenant-ask-ai-body" tabIndex={0} aria-label="Conversation history">
            {/* Welcome bubble */}
            <div className="tenant-ask-ai-welcome">{welcome}</div>

            {/* Suggested question chips (shown when no messages yet) */}
            {messages.length === 0 && suggested.length > 0 && (
              <div className="tenant-ask-ai-chips">
                {suggested.map((q, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="tenant-ask-ai-chip"
                    onClick={() => handleSend(q)}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {/* Conversation messages */}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={
                  msg.role === 'user'
                    ? 'tenant-ask-ai-user-bubble'
                    : 'tenant-ask-ai-bot-bubble'
                }
              >
                <div className="tenant-ask-ai-content">{msg.content}</div>

                {/* Sources cards */}
                {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                  <div className="tenant-ask-ai-sources-list">
                    {msg.sources.map((src) => (
                      <Link
                        key={src.id}
                        href={`/g/${encodeURIComponent(src.slug)}${src.start_step ? `#step-${src.start_step}` : ''}`}
                        className="tenant-ask-ai-source-card"
                      >
                        <span className="tenant-ask-ai-source-title">{src.title}</span>
                        <span className="tenant-ask-ai-source-steps">{src.step_range}</span>
                      </Link>
                    ))}
                  </div>
                )}

                {/* Helpful Yes/No buttons for answered assistant messages */}
                {msg.role === 'assistant' && msg.status === 'answered' && (
                  <div className="tenant-ask-ai-vote">
                    <span>Helpful?</span>
                    {msg.voted ? (
                      <span className="tenant-ask-ai-vote-done">Thank you for your feedback!</span>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="tenant-ask-ai-vote-btn"
                          onClick={() => handleVote(msg.id, true)}
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          className="tenant-ask-ai-vote-btn"
                          onClick={() => handleVote(msg.id, false)}
                        >
                          No
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* No match / out of credits contact options */}
                {msg.role === 'assistant' &&
                  (msg.status === 'no_match' || msg.status === 'out_of_credits') &&
                  noMatchMode !== 'hide' && (
                    <div className="tenant-ask-ai-contact-actions">
                      {contactHref && (
                        <a
                          href={contactHref}
                          className="tenant-ask-ai-contact-btn"
                        >
                          Contact support
                        </a>
                      )}
                      <a
                        href={getEmailQuestionHref(msg.question)}
                        className="tenant-ask-ai-contact-btn"
                      >
                        Email this question
                      </a>
                    </div>
                  )}
              </div>
            ))}

            {/* Typing indicator */}
            {loading && (
              <div className="tenant-ask-ai-typing" aria-label="Assistant is typing">
                <span className="tenant-ask-ai-typing-text">Thinking</span>
                <span className="tenant-ask-ai-dot" />
                <span className="tenant-ask-ai-dot" />
                <span className="tenant-ask-ai-dot" />
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Form */}
          <form
            className="tenant-ask-ai-input-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend(input);
            }}
          >
            <input
              ref={inputRef}
              type="text"
              className="tenant-ask-ai-input"
              placeholder="Ask a question..."
              aria-label="Ask a question"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              readOnly={loading}
              aria-busy={loading}
            />
            <button
              type="submit"
              className="tenant-ask-ai-send-btn"
              disabled={loading || !input.trim()}
            >
              Send
            </button>
          </form>

          {/* Footer */}
          <div className="tenant-ask-ai-footer">
            AI can make mistakes. Check the linked guide.
          </div>
        </div>
      )}
    </>
  );
}
