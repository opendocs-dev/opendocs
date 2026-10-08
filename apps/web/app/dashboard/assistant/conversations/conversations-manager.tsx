'use client';

import { useState } from 'react';
import type {
  AssistantConversationItem,
  AssistantStats,
  ContentGapItem,
  FlowItem,
} from '@/lib/server-api';
import { relativeTime } from '@/lib/relative-time';

type Props = {
  initialStats: AssistantStats;
  initialGaps: ContentGapItem[];
  initialConversations: AssistantConversationItem[];
  guides: FlowItem[];
  plan: string;
};

type Tab = 'gaps' | 'questions';

function SparkleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z" />
    </svg>
  );
}

export function ConversationsManager({
  initialStats,
  initialGaps,
  initialConversations,
  guides,
}: Props) {
  const [stats, setStats] = useState<AssistantStats>(initialStats);
  const [gaps, setGaps] = useState<ContentGapItem[]>(initialGaps);
  const [conversations] = useState<AssistantConversationItem[]>(initialConversations);
  const [activeTab, setActiveTab] = useState<Tab>('gaps');

  const [selectedConvoIndex, setSelectedConvoIndex] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'ok' | 'err'>('ok');

  // Guide picker modal state
  const [pickingGuideForGap, setPickingGuideForGap] = useState<ContentGapItem | null>(null);
  const [selectedGuideId, setSelectedGuideId] = useState<string>(guides[0]?.public_id ?? '');
  const [attaching, setAttaching] = useState(false);

  const showToast = (message: string, type: 'ok' | 'err' = 'ok') => {
    setToastMessage(message);
    setToastType(type);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleRecordGuide = async (gap: ContentGapItem) => {
    // Generate prompt matching Issue 87 footnote:
    // "Record a guide" copies a prompt for your AI agent: "Record how to change a WhatsApp number and file it under WhatsApp."
    const cleanTopic = gap.query.replace(/^(how to|how do i|how can i)\s+/i, '').replace(/[?.!]+$/, '');
    const words = cleanTopic.split(/\s+/).filter(Boolean);
    const suggestedCategory = words.length > 0 ? words[words.length - 1] : 'Guides';
    const capitalizedCategory =
      suggestedCategory.charAt(0).toUpperCase() + suggestedCategory.slice(1);

    const promptText = `Record how to ${cleanTopic} and file it under ${capitalizedCategory}.`;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(promptText);
      }
      showToast(`Copied agent prompt: "${promptText}"`);
    } catch {
      showToast('Could not copy to clipboard. Please copy manually.', 'err');
    }
  };

  const handleDismissGap = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/assistant/gaps/${id}/dismiss`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to dismiss content gap');
      setGaps((prev) => prev.filter((g) => g.id !== id));
      setStats((prev) => ({
        ...prev,
        content_gaps: Math.max(0, prev.content_gaps - 1),
      }));
      showToast('Content gap dismissed');
    } catch {
      showToast('Could not dismiss content gap', 'err');
    }
  };

  const handleAttachGuide = async () => {
    if (!pickingGuideForGap || !selectedGuideId) return;
    setAttaching(true);
    try {
      const res = await fetch(`/api/v1/assistant/gaps/${pickingGuideForGap.id}/attach`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ flow_id: selectedGuideId }),
      });
      if (!res.ok) throw new Error('Failed to attach guide');
      setGaps((prev) => prev.filter((g) => g.id !== pickingGuideForGap.id));
      setStats((prev) => ({
        ...prev,
        content_gaps: Math.max(0, prev.content_gaps - 1),
      }));
      setPickingGuideForGap(null);
      showToast('Attached to guide successfully');
    } catch {
      showToast('Could not attach to guide', 'err');
    } finally {
      setAttaching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(conversations.length - 1, index + 1);
      setSelectedConvoIndex(next);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = Math.max(0, index - 1);
      setSelectedConvoIndex(prev);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelectedConvoIndex(index);
    }
  };

  const selectedConvo = conversations[selectedConvoIndex] ?? null;

  return (
    <div className="stack" style={{ gap: 20 }}>
      {/* Header with Title and Export CSV */}
      <div className="adm-pane-header">
        <div>
          <h1>Conversations and content gaps</h1>
          <div>Sample data, last 30 days</div>
        </div>
        <a
          href="/api/v1/assistant/export?days=30"
          download="assistant-conversations.csv"
          className="btn"
          aria-label="Export CSV"
        >
          Export CSV
        </a>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          className={`callout ${toastType === 'ok' ? 'ok' : 'bad'}`}
          style={{ padding: '8px 14px', fontSize: 13 }}
        >
          {toastMessage}
        </div>
      )}

      {/* Five Stat Cards */}
      <div
        className="grid5"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
        }}
      >
        <div className="stat">
          <b>{stats.questions.toLocaleString()}</b>
          <span>Questions</span>
        </div>
        <div className="stat">
          <b>{stats.answered_percent}%</b>
          <span>Answered from guides</span>
        </div>
        <div className="stat">
          <b>{stats.helpful_percent}%</b>
          <span>Rated helpful</span>
        </div>
        <div className="stat">
          <b>{stats.content_gaps.toLocaleString()}</b>
          <span>Content gaps</span>
        </div>
        <div className="stat">
          <b>{stats.credits_used.toLocaleString()}</b>
          <span>Credits used</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="adm-tabs" role="tablist" aria-label="Conversation views">
        <button
          type="button"
          role="tab"
          id="tab-gaps"
          aria-controls="panel-gaps"
          aria-selected={activeTab === 'gaps'}
          className={`adm-tab ${activeTab === 'gaps' ? 'active' : ''}`}
          onClick={() => setActiveTab('gaps')}
        >
          Content gaps ({gaps.length})
        </button>
        <button
          type="button"
          role="tab"
          id="tab-questions"
          aria-controls="panel-questions"
          aria-selected={activeTab === 'questions'}
          className={`adm-tab ${activeTab === 'questions' ? 'active' : ''}`}
          onClick={() => setActiveTab('questions')}
        >
          Questions ({conversations.length})
        </button>
      </div>

      {/* Content Gaps Panel */}
      {activeTab === 'gaps' && (
        <div id="panel-gaps" role="tabpanel" aria-labelledby="tab-gaps" className="stack" style={{ gap: 12 }}>
          {gaps.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
              <div style={{ color: 'var(--a-muted)', marginBottom: 8 }}>
                <SparkleIcon />
              </div>
              <h3>No content gaps</h3>
              <p className="sub" style={{ maxWidth: 440, margin: '8px auto 0' }}>
                When readers ask questions that aren&rsquo;t answered by your guides, they will appear here
                so you can record new guides.
              </p>
            </div>
          ) : (
            <>
              {gaps.map((gap) => (
                <div
                  key={gap.id}
                  className="card"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 16,
                    flexWrap: 'wrap',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      flex: 1,
                      minWidth: 260,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 32,
                        height: 32,
                        borderRadius: 6,
                        background: 'var(--a-line)',
                        color: 'var(--a-brand)',
                        flexShrink: 0,
                      }}
                      aria-hidden="true"
                    >
                      <SparkleIcon />
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <strong>{gap.query}</strong>
                        <span className="badge badge-muted">
                          {gap.count} {gap.count === 1 ? 'question' : 'questions'}
                        </span>
                      </div>
                      <div className="sub" style={{ fontSize: 12, marginTop: 2 }}>
                        Last asked {relativeTime(gap.last_seen_at)}
                      </div>
                    </div>
                  </div>

                  <div className="btns" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handleRecordGuide(gap)}
                    >
                      Record a guide
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setPickingGuideForGap(gap);
                        if (guides[0]) setSelectedGuideId(guides[0].public_id);
                      }}
                    >
                      Add to a guide
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => handleDismissGap(gap.id)}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}

              <p className="sub" style={{ fontSize: 13, marginTop: 4 }}>
                Footnote: &ldquo;Record a guide&rdquo; copies a prompt for your AI agent to record and file the missing documentation.
              </p>
            </>
          )}
        </div>
      )}

      {/* Questions Panel */}
      {activeTab === 'questions' && (
        <div id="panel-questions" role="tabpanel" aria-labelledby="tab-questions">
          {conversations.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
              <h3>No questions yet</h3>
              <p className="sub" style={{ maxWidth: 440, margin: '8px auto 0' }}>
                Questions asked by readers on your site will appear here along with answer ratings.
              </p>
            </div>
          ) : (
            <div
              className="split"
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1.8fr)',
                gap: 16,
                alignItems: 'start',
              }}
            >
              {/* Questions List */}
              <div
                className="card"
                style={{ padding: 0, overflow: 'hidden' }}
                role="listbox"
                aria-label="Reader questions list"
              >
                {conversations.map((convo, idx) => {
                  const isSelected = selectedConvoIndex === idx;
                  return (
                    <div
                      key={convo.id}
                      role="option"
                      tabIndex={0}
                      aria-selected={isSelected}
                      onClick={() => setSelectedConvoIndex(idx)}
                      onKeyDown={(e) => handleKeyDown(e, idx)}
                      style={{
                        padding: '12px 16px',
                        cursor: 'pointer',
                        borderBottom: '1px solid var(--a-line)',
                        background: isSelected ? 'var(--a-line)' : 'transparent',
                        transition: 'background 0.15s ease',
                        outline: 'none',
                      }}
                    >
                      <div
                        style={{
                          fontWeight: isSelected ? 600 : 500,
                          marginBottom: 4,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {convo.question || 'No question content'}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 12,
                          color: 'var(--a-muted)',
                        }}
                      >
                        <span>{relativeTime(convo.created_at)}</span>
                        <span className={`badge ${convo.answered ? 'badge-ok' : 'badge-warn'}`}>
                          {convo.answered ? 'Answered' : 'No answer'}
                        </span>
                        {convo.rating === 'helpful' && (
                          <span className="badge badge-ai">Helpful</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Conversation Detail Card */}
              {selectedConvo && (
                <div className="card stack" style={{ gap: 16 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderBottom: '1px solid var(--a-line)',
                      paddingBottom: 10,
                    }}
                  >
                    <h3 style={{ margin: 0 }}>Conversation</h3>
                    <span className="sub" style={{ fontSize: 12 }}>
                      {relativeTime(selectedConvo.created_at)}
                    </span>
                  </div>

                  <div className="stack" style={{ gap: 14 }}>
                    {selectedConvo.messages.map((msg) => {
                      const isUser = msg.role === 'user';
                      return (
                        <div
                          key={msg.id}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: isUser ? 'flex-end' : 'flex-start',
                          }}
                        >
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: 'var(--a-muted)',
                              marginBottom: 4,
                            }}
                          >
                            {isUser ? 'Visitor' : 'Assistant'}
                          </div>
                          <div
                            style={{
                              maxWidth: '90%',
                              padding: '10px 14px',
                              borderRadius: 8,
                              background: isUser ? 'var(--a-line)' : 'var(--a-surface)',
                              border: isUser ? 'none' : '1px solid var(--a-line)',
                              color: 'var(--a-ink)',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              fontSize: 14,
                              lineHeight: 1.5,
                            }}
                          >
                            {msg.content}
                          </div>
                          {msg.rating === 'helpful' && (
                            <span
                              className="badge badge-ai"
                              style={{ marginTop: 6, fontSize: 11 }}
                            >
                              Helpful
                            </span>
                          )}
                        </div>
                      );
                    })}

                    {!selectedConvo.answered && (
                      <div
                        className="callout neutral"
                        style={{
                          marginTop: 8,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          borderLeft: '3px solid var(--a-warn)',
                        }}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 20 20"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          aria-hidden="true"
                        >
                          <path d="M10 2L1 18h18L10 2z" strokeLinejoin="round" />
                          <path d="M10 8v4m0 3v.5" strokeLinecap="round" />
                        </svg>
                        <span>No guide matched. Counted in content gaps.</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Guide Picker Dialog Modal */}
      {pickingGuideForGap && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="attach-guide-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: 16,
          }}
          onClick={() => setPickingGuideForGap(null)}
        >
          <div
            className="card stack"
            style={{ maxWidth: 460, width: '100%', gap: 16 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 id="attach-guide-title">Add to a guide</h3>
              <p className="sub" style={{ marginTop: 4 }}>
                Attach &ldquo;{pickingGuideForGap.query}&rdquo; to an existing guide to resolve this content gap.
              </p>
            </div>

            <div className="fld">
              <label htmlFor="guide-select">Select guide</label>
              <select
                id="guide-select"
                value={selectedGuideId}
                onChange={(e) => setSelectedGuideId(e.target.value)}
              >
                {guides.length === 0 ? (
                  <option value="">No guides available</option>
                ) : (
                  guides.map((g) => (
                    <option key={g.public_id} value={g.public_id}>
                      {g.title}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="btns" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={() => setPickingGuideForGap(null)}
                disabled={attaching}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleAttachGuide}
                disabled={attaching || !selectedGuideId}
              >
                {attaching ? 'Attaching...' : 'Add to guide'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
