'use client';

import Link from 'next/link';
import { useState } from 'react';
import type {
  AdminCategory,
  AssistantIndexStatus,
  AssistantModelOption,
  AssistantModelReplyStat,
  AssistantResponse,
  AssistantSettings,
  FlowItem,
} from '@/lib/server-api';
import { apiErrorMessage } from '@/lib/site-address';
import { ChatPreview } from './chat-preview';

type Tab = 'setup' | 'knowledge' | 'behavior' | 'model' | 'where';

type Props = {
  initial: AssistantResponse;
  plan: string;
  categories: AdminCategory[];
  guides: FlowItem[];
  sitePreset?: string;
  siteHost?: string;
};

export function AssistantManager({
  initial,
  plan,
  categories,
  guides,
  sitePreset = 'sage',
  siteHost = 'yourdomain.com',
}: Props) {
  const isEnterprise = plan === 'enterprise';

  const [assistant, setAssistant] = useState<AssistantSettings>(initial.assistant);
  const [savedAssistant, setSavedAssistant] = useState<AssistantSettings>(initial.assistant);
  const [credits, setCredits] = useState(initial.credits);
  const [models] = useState<AssistantModelOption[]>(initial.models);
  const [repliesByModel] = useState<AssistantModelReplyStat[]>(initial.replies_by_model);
  const [indexStatus, setIndexStatus] = useState<AssistantIndexStatus>(initial.index_status);

  const [activeTab, setActiveTab] = useState<Tab>('setup');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // New BYO Secret and Origins
  const [byoSecretInput, setByoSecretInput] = useState('');
  const [embedOriginsInput, setEmbedOriginsInput] = useState(
    assistant.embed_origins.join('\n'),
  );

  // Reindex & Connection Test State
  const [reindexing, setReindexing] = useState(false);
  const [reindexMessage, setReindexMessage] = useState<string | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<{
    ok: boolean;
    message?: string;
    error?: string;
  } | null>(null);

  // Check if form has unsaved changes
  const hasChanges =
    JSON.stringify(assistant) !== JSON.stringify(savedAssistant) ||
    byoSecretInput.trim().length > 0 ||
    embedOriginsInput.trim() !== savedAssistant.embed_origins.join('\n');

  // Handle Save
  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setStatus(null);

    try {
      const origins = embedOriginsInput
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);

      const payload: Record<string, unknown> = {
        enabled: assistant.enabled,
        name: assistant.name,
        button_label: assistant.button_label,
        welcome: assistant.welcome,
        suggested: assistant.suggested.slice(0, 4),
        tone: assistant.tone,
        language: assistant.language,
        source_mode: assistant.source_mode,
        source_category_ids: assistant.source_category_ids,
        excluded_flow_ids: assistant.excluded_flow_ids,
        no_match_mode: assistant.no_match_mode,
        contact_target: assistant.contact_target,
        off_topic_refusal: assistant.off_topic_refusal,
        show_sources: assistant.show_sources,
        hourly_per_visitor: assistant.hourly_per_visitor,
        daily_cap: assistant.daily_cap,
        retention_days: assistant.retention_days,
        mask_pii: assistant.mask_pii,
        position: assistant.position,
        model_id: assistant.model_id,
      };

      if (isEnterprise) {
        payload.byo_enabled = assistant.byo_enabled;
        payload.byo_provider = assistant.byo_provider;
        payload.byo_base_url = assistant.byo_base_url;
        payload.byo_model = assistant.byo_model;
        payload.byo_fallback_credits = assistant.byo_fallback_credits;
        payload.embed_origins = origins;
        if (byoSecretInput.trim()) {
          payload.byo_secret = byoSecretInput.trim();
        }
      }

      const res = await fetch('/api/v1/assistant', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(apiErrorMessage(body, `Save failed (${res.status})`));
      }

      const data = (await res.json()) as { assistant: AssistantSettings };
      setAssistant(data.assistant);
      setSavedAssistant(data.assistant);
      setByoSecretInput('');
      setEmbedOriginsInput(data.assistant.embed_origins.join('\n'));
      setStatus('Saved changes');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // Reindex handler
  const handleReindex = async () => {
    if (reindexing) return;
    setReindexing(true);
    setReindexMessage(null);
    try {
      const res = await fetch('/api/v1/assistant/reindex', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error(`Reindex failed (${res.status})`);
      }
      const data = (await res.json()) as { ok: boolean; indexed_count: number; reindexed_at: string };
      setIndexStatus((prev) => ({
        ...prev,
        indexed_count: data.indexed_count,
        last_indexed_at: data.reindexed_at,
      }));
      setReindexMessage(`Reindexed ${data.indexed_count} guides successfully.`);
    } catch (err) {
      setReindexMessage(err instanceof Error ? err.message : 'Reindex failed');
    } finally {
      setReindexing(false);
    }
  };

  // BYOK Connection Test handler
  const handleTestConnection = async () => {
    if (testingConnection) return;
    setTestingConnection(true);
    setConnectionTestResult(null);

    try {
      const res = await fetch('/api/v1/assistant/test-connection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          provider: assistant.byo_provider,
          base_url: assistant.byo_base_url || null,
          api_key: byoSecretInput.trim() || undefined,
        }),
      });

      const data = (await res.json()) as { ok: boolean; message?: string; error?: string };
      if (!res.ok) {
        setConnectionTestResult({
          ok: false,
          error: data.error || (data as unknown as { error?: { message?: string } })?.error?.message || `Test failed with status ${res.status}`,
        });
      } else {
        setConnectionTestResult(data);
      }
    } catch (err) {
      setConnectionTestResult({
        ok: false,
        error: err instanceof Error ? err.message : 'Connection test failed',
      });
    } finally {
      setTestingConnection(false);
    }
  };

  // Suggested questions helpers
  const handleSuggestedChange = (index: number, val: string) => {
    const next = [...assistant.suggested];
    next[index] = val;
    setAssistant({ ...assistant, suggested: next });
  };

  const addSuggestedQuestion = () => {
    if (assistant.suggested.length < 4) {
      setAssistant({ ...assistant, suggested: [...assistant.suggested, ''] });
    }
  };

  const removeSuggestedQuestion = (index: number) => {
    const next = assistant.suggested.filter((_, i) => i !== index);
    setAssistant({ ...assistant, suggested: next });
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      {/* Pane Header */}
      <div className="adm-pane-header">
        <div>
          <h1>AI assistant</h1>
          <div>Configure how your assistant answers readers</div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving || !hasChanges}
        >
          {saving ? 'Saving...' : 'Save changes'}
        </button>
      </div>

      {status && (
        <p className="msg ok" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="msg err" role="alert">
          {error}
        </p>
      )}

      {/* Top Card: On/Off toggle & Credit overview */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', margin: 0, fontWeight: 600, fontSize: 16 }}>
          <input
            type="checkbox"
            checked={assistant.enabled}
            onChange={(e) => setAssistant({ ...assistant, enabled: e.target.checked })}
            style={{ width: 18, height: 18 }}
          />
          <span>Assistant is {assistant.enabled ? 'on' : 'off'}</span>
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13.5 }}>
          <span className="badge badge-ai">Credits</span>
          <span style={{ color: 'var(--a-muted)' }}>
            <strong>{credits.used.toLocaleString()}</strong> of {credits.total.toLocaleString()} credits used this month
          </span>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="btns" role="tablist" aria-label="AI assistant tabs">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'setup'}
          className={activeTab === 'setup' ? 'btn btn-primary' : 'btn'}
          onClick={() => setActiveTab('setup')}
        >
          Setup
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'knowledge'}
          className={activeTab === 'knowledge' ? 'btn btn-primary' : 'btn'}
          onClick={() => setActiveTab('knowledge')}
        >
          Knowledge
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'behavior'}
          className={activeTab === 'behavior' ? 'btn btn-primary' : 'btn'}
          onClick={() => setActiveTab('behavior')}
        >
          Behavior
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'model'}
          className={activeTab === 'model' ? 'btn btn-primary' : 'btn'}
          onClick={() => setActiveTab('model')}
        >
          Model and credits
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'where'}
          className={activeTab === 'where' ? 'btn btn-primary' : 'btn'}
          onClick={() => setActiveTab('where')}
        >
          Where it appears
        </button>
      </div>

      {/* Tab 1: Setup */}
      {activeTab === 'setup' && (
        <div className="split">
          <div className="card stack" style={{ gap: 14 }}>
            <h3>Identity</h3>

            <div className="fld">
              <label htmlFor="ai-name">Name</label>
              <input
                id="ai-name"
                type="text"
                value={assistant.name}
                onChange={(e) => setAssistant({ ...assistant, name: e.target.value })}
                placeholder="e.g. Acme Assistant"
              />
            </div>

            <div className="fld">
              <label htmlFor="ai-button-label">Button label</label>
              <input
                id="ai-button-label"
                type="text"
                value={assistant.button_label}
                onChange={(e) => setAssistant({ ...assistant, button_label: e.target.value })}
                placeholder="e.g. Ask AI"
              />
            </div>

            <div className="fld">
              <label htmlFor="ai-welcome">Welcome message</label>
              <textarea
                id="ai-welcome"
                rows={3}
                value={assistant.welcome}
                onChange={(e) => setAssistant({ ...assistant, welcome: e.target.value })}
                placeholder="e.g. How can I help you today?"
              />
            </div>

            <div className="fld">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <label style={{ margin: 0 }}>Suggested questions (up to 4)</label>
                {assistant.suggested.length < 4 && (
                  <button
                    type="button"
                    className="btn"
                    style={{ fontSize: 12, padding: '2px 8px' }}
                    onClick={addSuggestedQuestion}
                  >
                    + Add question
                  </button>
                )}
              </div>
              <div className="stack" style={{ gap: 8 }}>
                {assistant.suggested.map((q, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      value={q}
                      onChange={(e) => handleSuggestedChange(idx, e.target.value)}
                      placeholder={`Question ${idx + 1}`}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => removeSuggestedQuestion(idx)}
                      style={{ padding: '0 10px' }}
                      title="Remove question"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {assistant.suggested.length === 0 && (
                  <p className="sub" style={{ margin: 0 }}>No suggested questions added yet.</p>
                )}
              </div>
            </div>

            <div className="fld">
              <label htmlFor="ai-tone">Tone</label>
              <select
                id="ai-tone"
                value={assistant.tone}
                onChange={(e) => setAssistant({ ...assistant, tone: e.target.value as 'friendly' | 'concise' | 'formal' })}
              >
                <option value="friendly">Friendly</option>
                <option value="concise">Neutral / Concise</option>
                <option value="formal">Formal</option>
              </select>
            </div>

            <div className="fld">
              <label htmlFor="ai-language">Language</label>
              <select
                id="ai-language"
                value={assistant.language}
                onChange={(e) => setAssistant({ ...assistant, language: e.target.value })}
              >
                <option value="auto">Same as the question (Auto)</option>
                <option value="en">English</option>
                <option value="id">Bahasa Indonesia</option>
              </select>
            </div>
          </div>

          {/* Right: Live Chat Preview */}
          <div className="card stack" style={{ gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Preview (uses your look)</h3>
              <span className="badge" style={{ textTransform: 'capitalize' }}>
                Preset: {sitePreset}
              </span>
            </div>
            <ChatPreview
              name={assistant.name}
              buttonLabel={assistant.button_label}
              welcome={assistant.welcome}
              suggested={assistant.suggested}
              preset={sitePreset}
              showSources={assistant.show_sources}
            />
          </div>
        </div>
      )}

      {/* Tab 2: Knowledge */}
      {activeTab === 'knowledge' && (
        <div className="stack" style={{ gap: 20 }}>
          <div className="card stack" style={{ gap: 14 }}>
            <h3>What it can use</h3>
            <div className="stack" style={{ gap: 10 }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="source_mode"
                  checked={assistant.source_mode === 'all'}
                  onChange={() => setAssistant({ ...assistant, source_mode: 'all' })}
                  style={{ marginTop: 3 }}
                />
                <div>
                  <strong>All published guides</strong>
                  <div className="sub">New guides are added automatically.</div>
                </div>
              </label>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="source_mode"
                  checked={assistant.source_mode === 'categories'}
                  onChange={() => setAssistant({ ...assistant, source_mode: 'categories' })}
                  style={{ marginTop: 3 }}
                />
                <div>
                  <strong>Only selected categories</strong>
                  <div className="sub">Guides outside them are ignored.</div>
                </div>
              </label>

              {assistant.source_mode === 'categories' && (
                <div style={{ marginLeft: 26, padding: '12px 16px', background: 'var(--a-bg)', borderRadius: 8 }} className="stack">
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Select categories:</div>
                  {categories.map((cat) => {
                    const checked = assistant.source_category_ids.includes(cat.id);
                    return (
                      <label key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...assistant.source_category_ids, cat.id]
                              : assistant.source_category_ids.filter((id) => id !== cat.id);
                            setAssistant({ ...assistant, source_category_ids: next });
                          }}
                        />
                        <span>{cat.name}</span>
                      </label>
                    );
                  })}
                  {categories.length === 0 && (
                    <div className="sub">No categories available in this workspace.</div>
                  )}
                </div>
              )}
            </div>

            <p className="callout" style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--a-warn)' }}>
              Drafts and unlisted guides are never used.
            </p>
          </div>

          <div className="card stack" style={{ gap: 14 }}>
            <h3>Index</h3>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                {indexStatus.indexed_count} {indexStatus.indexed_count === 1 ? 'guide' : 'guides'} indexed
              </div>
              <div className="sub">
                Last updated {indexStatus.last_indexed_at ? new Date(indexStatus.last_indexed_at).toLocaleTimeString() : 'never'}.
              </div>
            </div>

            {/* Meter Bar */}
            <div style={{ height: 8, width: '100%', background: 'var(--a-line)', borderRadius: 4, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${indexStatus.total_count > 0 ? Math.min(100, Math.round((indexStatus.indexed_count / indexStatus.total_count) * 100)) : 0}%`,
                  background: 'var(--a-ok)',
                }}
              />
            </div>

            <div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleReindex}
                disabled={reindexing}
              >
                {reindexing ? 'Reindexing...' : 'Reindex now'}
              </button>
              {reindexMessage && (
                <span style={{ marginLeft: 12, fontSize: 13, color: 'var(--a-ok)' }}>
                  {reindexMessage}
                </span>
              )}
            </div>

            <div className="fld" style={{ marginTop: 8 }}>
              <label>Leave out specific guides</label>
              <div className="sub" style={{ marginBottom: 8 }}>
                Selected guides will be excluded from the assistant’s index.
              </div>
              <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--a-line)', borderRadius: 8, padding: 10 }} className="stack">
                {guides.map((g) => {
                  const isExcluded = assistant.excluded_flow_ids.includes(g.public_id);
                  return (
                    <label key={g.public_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={isExcluded}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...assistant.excluded_flow_ids, g.public_id]
                            : assistant.excluded_flow_ids.filter((id) => id !== g.public_id);
                          setAssistant({ ...assistant, excluded_flow_ids: next });
                        }}
                      />
                      <span>{g.title}</span>
                    </label>
                  );
                })}
                {guides.length === 0 && (
                  <div className="sub">No published guides available to exclude.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Behavior */}
      {activeTab === 'behavior' && (
        <div className="stack" style={{ gap: 20 }}>
          <div className="card stack" style={{ gap: 14 }}>
            <h3>Answers</h3>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'not-allowed', color: 'var(--a-muted)' }}>
              <input type="checkbox" checked disabled />
              <span>Answer only from guides (always on)</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={assistant.show_sources}
                onChange={(e) => setAssistant({ ...assistant, show_sources: e.target.checked })}
              />
              <span>Show the guides it used</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={assistant.off_topic_refusal}
                onChange={(e) => setAssistant({ ...assistant, off_topic_refusal: e.target.checked })}
              />
              <span>Refuse off-topic questions</span>
            </label>

            <div className="fld" style={{ marginTop: 10 }}>
              <label>When nothing matches</label>
              <div className="stack" style={{ gap: 8, marginTop: 4 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="no_match_mode"
                    checked={assistant.no_match_mode === 'contact'}
                    onChange={() => setAssistant({ ...assistant, no_match_mode: 'contact' })}
                  />
                  <span>Offer contact options</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="no_match_mode"
                    checked={assistant.no_match_mode === 'email'}
                    onChange={() => setAssistant({ ...assistant, no_match_mode: 'email' })}
                  />
                  <span>Collect the visitor&apos;s email and question</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="no_match_mode"
                    checked={assistant.no_match_mode === 'hide'}
                    onChange={() => setAssistant({ ...assistant, no_match_mode: 'hide' })}
                  />
                  <span>Say it cannot help</span>
                </label>
              </div>
            </div>

            <div className="fld">
              <label htmlFor="ai-contact">Contact link or email</label>
              <input
                id="ai-contact"
                type="text"
                value={assistant.contact_target}
                onChange={(e) => setAssistant({ ...assistant, contact_target: e.target.value })}
                placeholder="e.g. https://support.example.com or help@example.com"
              />
            </div>
          </div>

          <div className="card stack" style={{ gap: 14 }}>
            <h3>Limits and privacy</h3>

            <div className="fld">
              <label htmlFor="ai-hourly">Questions per visitor per hour</label>
              <select
                id="ai-hourly"
                value={assistant.hourly_per_visitor}
                onChange={(e) => setAssistant({ ...assistant, hourly_per_visitor: Number(e.target.value) })}
              >
                <option value={10}>10 questions</option>
                <option value={20}>20 questions</option>
                <option value={30}>30 questions</option>
                <option value={50}>50 questions</option>
              </select>
            </div>

            <div className="fld">
              <label htmlFor="ai-daily-cap">Daily answer cap</label>
              <input
                id="ai-daily-cap"
                type="number"
                min={10}
                max={10000}
                value={assistant.daily_cap}
                onChange={(e) => setAssistant({ ...assistant, daily_cap: Number(e.target.value) })}
              />
            </div>

            <div className="fld">
              <label htmlFor="ai-retention">Keep conversations for</label>
              <select
                id="ai-retention"
                value={assistant.retention_days}
                onChange={(e) => setAssistant({ ...assistant, retention_days: Number(e.target.value) })}
              >
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={365}>365 days</option>
              </select>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 6 }}>
              <input
                type="checkbox"
                checked={assistant.mask_pii}
                onChange={(e) => setAssistant({ ...assistant, mask_pii: e.target.checked })}
              />
              <span>Hide personal data in saved questions</span>
            </label>
          </div>
        </div>
      )}

      {/* Tab 4: Model and credits */}
      {activeTab === 'model' && (
        <div className="stack" style={{ gap: 20 }}>
          {/* Credits Meter Card */}
          <div className="card stack" style={{ gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3>Credits</h3>
                <div className="sub">
                  {credits.used.toLocaleString()} of {credits.total.toLocaleString()} credits used this month &bull; resets {credits.reset_date}
                </div>
              </div>
              <Link href="/dashboard/plan" className="btn btn-secondary">
                Add credits
              </Link>
            </div>
            <div style={{ height: 10, width: '100%', background: 'var(--a-line)', borderRadius: 5, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${credits.percent}%`,
                  background: credits.percent > 90 ? 'var(--a-bad)' : 'var(--a-brand)',
                }}
              />
            </div>
          </div>

          {/* Model Catalog Radio Cards */}
          <div className="card stack" style={{ gap: 14 }}>
            <h3>Model</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {models.map((m) => {
                const isSelected = (assistant.model_id ?? models[0]?.model_id) === m.model_id;
                return (
                  <div
                    key={m.id}
                    onClick={() => setAssistant({ ...assistant, model_id: m.model_id })}
                    style={{
                      border: `2px solid ${isSelected ? 'var(--a-brand)' : 'var(--a-line)'}`,
                      borderRadius: 10,
                      padding: 14,
                      cursor: 'pointer',
                      background: isSelected ? 'var(--a-soft)' : 'var(--a-surface)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span className="badge" style={{ textTransform: 'uppercase', fontSize: 10 }}>
                        {m.provider}
                      </span>
                      <span className="badge badge-ai" style={{ fontSize: 11 }}>
                        {m.label}
                      </span>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{m.name}</div>
                    <div className="sub" style={{ fontSize: 12 }}>
                      {m.credits_per_reply} {m.credits_per_reply === 1 ? 'credit' : 'credits'} per reply
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Replies by Model Table */}
          <div className="card stack" style={{ gap: 12 }}>
            <h3>Replies by model, last 30 days</h3>
            {repliesByModel.length > 0 ? (
              <table className="adm">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Replies</th>
                    <th>Credits used</th>
                  </tr>
                </thead>
                <tbody>
                  {repliesByModel.map((row) => (
                    <tr key={row.model_id}>
                      <td><strong>{row.model_name}</strong></td>
                      <td>{row.replies_count.toLocaleString()}</td>
                      <td>{row.credits_used.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="sub">No replies in the last 30 days.</div>
            )}
          </div>

          {/* BYOK: Use your own provider (Enterprise only) */}
          <div className={`card card-lock stack ${isEnterprise ? '' : 'is-locked'}`} style={{ gap: 14 }}>
            {!isEnterprise && (
              <div className="card-veil">
                <div className="card-veil-box">
                  <span className="badge badge-ai" style={{ marginBottom: 8 }}>Enterprise</span>
                  <p><b>Use your own provider is on Enterprise</b></p>
                  <p className="sub" style={{ margin: '6px 0 16px' }}>
                    Bring your own API keys from Anthropic, OpenAI or compatible models.
                  </p>
                  <Link href="/dashboard/plan" className="btn btn-primary">
                    See plans
                  </Link>
                </div>
              </div>
            )}

            <div>
              <h3>Use your own provider</h3>
              <div className="sub">Connect directly to OpenAI, Anthropic, or an OpenAI-compatible endpoint.</div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={assistant.byo_enabled}
                onChange={(e) => setAssistant({ ...assistant, byo_enabled: e.target.checked })}
              />
              <span>Enable custom provider</span>
            </label>

            {assistant.byo_enabled && (
              <div className="stack" style={{ gap: 12 }}>
                <div className="fld">
                  <label htmlFor="byo-provider">Provider</label>
                  <select
                    id="byo-provider"
                    value={assistant.byo_provider || 'anthropic'}
                    onChange={(e) => setAssistant({ ...assistant, byo_provider: e.target.value })}
                  >
                    <option value="anthropic">Anthropic</option>
                    <option value="openai">OpenAI</option>
                    <option value="compatible">OpenAI-compatible</option>
                  </select>
                </div>

                <div className="fld">
                  <label htmlFor="byo-model">Model</label>
                  <input
                    id="byo-model"
                    type="text"
                    value={assistant.byo_model || ''}
                    onChange={(e) => setAssistant({ ...assistant, byo_model: e.target.value })}
                    placeholder="e.g. claude-3-5-sonnet-20241022 or gpt-4o"
                  />
                </div>

                <div className="fld">
                  <label htmlFor="byo-base-url">Base URL</label>
                  <input
                    id="byo-base-url"
                    type="text"
                    value={assistant.byo_base_url || ''}
                    onChange={(e) => setAssistant({ ...assistant, byo_base_url: e.target.value })}
                    placeholder="https://api.openai.com/v1"
                  />
                  <small className="muted">
                    Must be https and reachable from the internet. Private addresses are refused.
                  </small>
                </div>

                <div className="fld">
                  <label htmlFor="byo-secret">
                    API key {assistant.byo_secret_set && <span className="sub">(configured: {assistant.byo_secret_masked})</span>}
                  </label>
                  <input
                    id="byo-secret"
                    type="password"
                    value={byoSecretInput}
                    onChange={(e) => setByoSecretInput(e.target.value)}
                    placeholder={assistant.byo_secret_set ? 'Enter new key to replace' : 'sk-...'}
                  />
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={assistant.byo_fallback_credits}
                    onChange={(e) => setAssistant({ ...assistant, byo_fallback_credits: e.target.checked })}
                  />
                  <span>If my key fails, use OpenDocs credits</span>
                </label>

                <div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleTestConnection}
                    disabled={testingConnection}
                  >
                    {testingConnection ? 'Testing connection...' : 'Test connection'}
                  </button>
                </div>

                {connectionTestResult && (
                  <div
                    className={`msg ${connectionTestResult.ok ? 'ok' : 'err'}`}
                    role={connectionTestResult.ok ? 'status' : 'alert'}
                  >
                    {connectionTestResult.ok
                      ? connectionTestResult.message || 'Connected. Last test passed just now.'
                      : connectionTestResult.error || 'Connection failed.'}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 5: Where it appears */}
      {activeTab === 'where' && (
        <div className="stack" style={{ gap: 20 }}>
          <div className="card stack" style={{ gap: 14 }}>
            <h3>Appearance & Placement</h3>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={assistant.enabled}
                onChange={(e) => setAssistant({ ...assistant, enabled: e.target.checked })}
              />
              <span>Show the chat button</span>
            </label>

            <div className="fld">
              <label>Position</label>
              <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="position"
                    checked={assistant.position === 'bottom-right'}
                    onChange={() => setAssistant({ ...assistant, position: 'bottom-right' })}
                  />
                  <span>Bottom right</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="position"
                    checked={assistant.position === 'bottom-left'}
                    onChange={() => setAssistant({ ...assistant, position: 'bottom-left' })}
                  />
                  <span>Bottom left</span>
                </label>
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 4 }}>
              <input type="checkbox" defaultChecked />
              <span>Show &quot;Ask AI&quot; in the navbar and on search results</span>
            </label>
          </div>

          {/* Embed on another site (Enterprise only) */}
          <div className={`card card-lock stack ${isEnterprise ? '' : 'is-locked'}`} style={{ gap: 14 }}>
            {!isEnterprise && (
              <div className="card-veil">
                <div className="card-veil-box">
                  <span className="badge badge-ai" style={{ marginBottom: 8 }}>Enterprise</span>
                  <p><b>Embed on another site is on Enterprise</b></p>
                  <p className="sub" style={{ margin: '6px 0 16px' }}>
                    Put the AI assistant on your own landing page or web app.
                  </p>
                  <Link href="/dashboard/plan" className="btn btn-primary">
                    See plans
                  </Link>
                </div>
              </div>
            )}

            <div>
              <h3>Embed on another site</h3>
              <div className="sub">Add this script to your site&apos;s HTML to render the chat widget.</div>
            </div>

            <div className="fld">
              <label>Embed snippet</label>
              <pre
                style={{
                  background: 'var(--a-bg)',
                  padding: 12,
                  borderRadius: 8,
                  fontSize: 12.5,
                  overflowX: 'auto',
                  border: '1px solid var(--a-line)',
                }}
              >
                <code>{`<script src="https://${siteHost}/ai.js" data-site="${siteHost}" async></script>`}</code>
              </pre>
            </div>

            <div className="fld">
              <label htmlFor="ai-allowed-sites">Allowed sites</label>
              <textarea
                id="ai-allowed-sites"
                rows={3}
                value={embedOriginsInput}
                onChange={(e) => setEmbedOriginsInput(e.target.value)}
                placeholder="https://example.com&#10;https://app.example.com"
              />
              <small className="muted">
                Comma-separated or newline-separated origins that are permitted to embed this assistant.
              </small>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
