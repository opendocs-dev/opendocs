'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { PlatformAiModel, PlatformAiProvider } from '@/lib/server-api';

type Props = {
  initialModels: PlatformAiModel[];
  initialProviders: PlatformAiProvider[];
  currentRole?: 'admin' | 'support';
};

function formatLastTested(isoDate: string | null | undefined): string {
  if (!isoDate) return 'Never tested';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return 'Never tested';
  const now = new Date();
  const isToday =
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate();
  if (isToday) return 'last test passed today';
  return `last tested ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

export function ModelsManager({ initialModels, initialProviders, currentRole = 'admin' }: Props) {
  const router = useRouter();
  const isAdmin = currentRole === 'admin';

  // Model state
  const [models, setModels] = useState<PlatformAiModel[]>(initialModels);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState<string>('Standard');
  const [editCredits, setEditCredits] = useState<number>(1);
  const [editPlans, setEditPlans] = useState<string[]>(['pro', 'enterprise']);
  const [editStatus, setEditStatus] = useState<string>('active');
  const [savingModel, setSavingModel] = useState<string | null>(null);

  // New model form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProvider, setNewProvider] = useState('openai');
  const [newModelId, setNewModelId] = useState('');
  const [newName, setNewName] = useState('');
  const [newLabel, setNewLabel] = useState('Standard');
  const [newCredits, setNewCredits] = useState(1);
  const [newPlans, setNewPlans] = useState<string[]>(['pro', 'enterprise']);
  const [addingModel, setAddingModel] = useState(false);
  const [testingNewModel, setTestingNewModel] = useState(false);

  // Provider state
  const [providers, setProviders] = useState<PlatformAiProvider[]>(initialProviders);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [providerKey, setProviderKey] = useState('');
  const [providerBaseUrl, setProviderBaseUrl] = useState('');
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [savingProvider, setSavingProvider] = useState<string | null>(null);

  // General feedback status
  const [statusMessage, setStatusMessage] = useState<{ type: 'ok' | 'bad'; text: string } | null>(null);

  const showStatus = (type: 'ok' | 'bad', text: string) => {
    setStatusMessage({ type, text });
    setTimeout(() => setStatusMessage(null), 5000);
  };

  const handleTestProvider = async (provider: string, secret?: string) => {
    setTestingProvider(provider);
    try {
      const res = await fetch('/api/v1/platform/ai/providers/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider, secret: secret || undefined }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        showStatus('ok', `Connection to ${provider} verified successfully.`);
        // Update local provider lastTestedAt
        setProviders((prev) =>
          prev.map((p) =>
            p.provider.toLowerCase() === provider.toLowerCase()
              ? { ...p, status: 'active', lastTestedAt: new Date().toISOString() }
              : p,
          ),
        );
        router.refresh();
      } else {
        showStatus('bad', data.error || `Failed to connect to ${provider}`);
      }
    } catch {
      showStatus('bad', `Network error testing ${provider}`);
    } finally {
      setTestingProvider(null);
    }
  };

  const handleSaveProvider = async (provider: string) => {
    if (!isAdmin) return;
    if (!providerKey.trim()) {
      showStatus('bad', 'API key is required');
      return;
    }

    setSavingProvider(provider);
    try {
      // First test key
      const testRes = await fetch('/api/v1/platform/ai/providers/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          provider,
          secret: providerKey.trim(),
          baseUrl: providerBaseUrl.trim() || undefined,
        }),
      });
      const testData = await testRes.json();
      if (!testRes.ok || !testData.ok) {
        showStatus('bad', testData.error || `Provider rejected API key`);
        setSavingProvider(null);
        return;
      }

      // If test passed, save encrypted
      const saveRes = await fetch('/api/v1/platform/ai/providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          provider,
          secret: providerKey.trim(),
          baseUrl: providerBaseUrl.trim() || undefined,
        }),
      });

      if (saveRes.ok) {
        const savedData = await saveRes.json();
        setProviders((prev) => {
          const filtered = prev.filter((p) => p.provider.toLowerCase() !== provider.toLowerCase());
          return [...filtered, savedData];
        });
        setEditingProvider(null);
        setProviderKey('');
        setProviderBaseUrl('');
        showStatus('ok', `${provider} API key tested and saved securely.`);
        router.refresh();
      } else {
        const err = await saveRes.json();
        showStatus('bad', err.error?.message || `Failed to save ${provider} key`);
      }
    } catch {
      showStatus('bad', `Failed to save ${provider} key`);
    } finally {
      setSavingProvider(null);
    }
  };

  const handleTestNewModel = async () => {
    if (!newProvider) return;
    setTestingNewModel(true);
    try {
      const res = await fetch('/api/v1/platform/ai/providers/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider: newProvider }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        showStatus('ok', `Connection test passed for ${newProvider} (${newModelId || 'default'}).`);
      } else {
        showStatus('bad', data.error || `Test failed: Check ${newProvider} provider configuration.`);
      }
    } catch {
      showStatus('bad', 'Network error testing model connection.');
    } finally {
      setTestingNewModel(false);
    }
  };

  const handleAddModel = async (statusOverride?: 'active' | 'hidden') => {
    if (!isAdmin) return;
    if (!newName.trim() || !newModelId.trim()) {
      showStatus('bad', 'Model ID and Name are required');
      return;
    }

    setAddingModel(true);
    const targetStatus = statusOverride ?? 'active';
    try {
      const res = await fetch('/api/v1/platform/ai/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: newName.trim(),
          provider: newProvider,
          modelId: newModelId.trim(),
          label: newLabel,
          creditsPerReply: Number(newCredits),
          plans: newPlans,
          status: targetStatus,
          isDefault: false,
        }),
      });

      if (res.ok) {
        const created = await res.json();
        setModels((prev) => [...prev, created]);
        setShowAddForm(false);
        setNewName('');
        setNewModelId('');
        showStatus('ok', `Model "${created.name}" created (${targetStatus}).`);
        router.refresh();
      } else {
        const err = await res.json();
        showStatus('bad', err.error?.message || 'Failed to create model');
      }
    } catch {
      showStatus('bad', 'Failed to create model');
    } finally {
      setAddingModel(false);
    }
  };

  const handleSaveModelEdit = async (id: string) => {
    if (!isAdmin) return;
    setSavingModel(id);
    try {
      const res = await fetch(`/api/v1/platform/ai/models/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          label: editLabel,
          creditsPerReply: Number(editCredits),
          plans: editPlans,
          status: editStatus,
        }),
      });

      if (res.ok) {
        const updated = await res.json();
        setModels((prev) => prev.map((m) => (m.id === id ? updated : m)));
        setEditingModelId(null);
        showStatus('ok', `Updated model "${updated.name}".`);
        router.refresh();
      } else {
        const err = await res.json();
        showStatus('bad', err.error?.message || 'Failed to update model');
      }
    } catch {
      showStatus('bad', 'Failed to update model');
    } finally {
      setSavingModel(null);
    }
  };

  const handleSetDefault = async (model: PlatformAiModel) => {
    if (!isAdmin) return;
    setSavingModel(model.id);
    try {
      const res = await fetch(`/api/v1/platform/ai/models/${model.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isDefault: true }),
      });

      if (res.ok) {
        setModels((prev) =>
          prev.map((m) => ({
            ...m,
            isDefault: m.id === model.id,
          })),
        );
        showStatus('ok', `Set "${model.name}" as default model.`);
        router.refresh();
      } else {
        showStatus('bad', 'Failed to set default model');
      }
    } catch {
      showStatus('bad', 'Failed to set default model');
    } finally {
      setSavingModel(null);
    }
  };

  const knownProviders = [
    { key: 'openai', label: 'OpenAI' },
    { key: 'anthropic', label: 'Anthropic' },
    { key: 'compatible', label: 'OpenAI-compatible' },
  ];

  const providerDisplayList = knownProviders.map((kp) => {
    const existing = providers.find((p) => p.provider.toLowerCase() === kp.key);
    return {
      key: kp.key,
      displayName: kp.label,
      baseUrl: existing?.baseUrl ?? null,
      status: existing?.hasSecret ? 'Working' : 'Off',
      hasSecret: Boolean(existing?.hasSecret),
      maskedSecret: existing?.maskedSecret ?? '',
      lastTestedAt: existing?.lastTestedAt ?? null,
    };
  });

  return (
    <div className="stack" style={{ gap: '24px' }}>
      {/* Pane Header */}
      <div className="adm-pane-header">
        <div>
          <h1>AI models and providers</h1>
          <div className="sub">What tenants can pick, and what a reply costs</div>
        </div>
        {isAdmin && (
          <div className="adm-buttons">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowAddForm(!showAddForm)}
            >
              {showAddForm ? 'Close form' : '+ Add model'}
            </button>
          </div>
        )}
      </div>

      {!isAdmin && (
        <div role="status" className="card" style={{ padding: '12px 16px', background: 'var(--a-soft)' }}>
          <b>Read-only access:</b> Platform admin role is required to modify AI models and provider keys.
        </div>
      )}

      {statusMessage && (
        <div
          role="status"
          className={`card ${statusMessage.type === 'ok' ? 'badge-ok' : 'badge-bad'}`}
          style={{ padding: '12px 16px' }}
        >
          {statusMessage.text}
        </div>
      )}

      {/* Card: Add a model */}
      {showAddForm && isAdmin && (
        <section className="card" style={{ padding: '20px' }}>
          <div style={{ marginBottom: '16px' }}>
            <h3 style={{ margin: '0 0 4px 0' }}>Add a model</h3>
            <p className="sub" style={{ margin: 0 }}>Configure a new LLM model available to tenants.</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Provider
              </label>
              <select
                value={newProvider}
                onChange={(e) => setNewProvider(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--a-line)' }}
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="compatible">OpenAI-compatible</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Model ID
              </label>
              <input
                type="text"
                placeholder="e.g. gpt-luna or claude-sonnet-5-5"
                value={newModelId}
                onChange={(e) => setNewModelId(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--a-line)' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Name tenants see
              </label>
              <input
                type="text"
                placeholder="e.g. GPT Luna"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--a-line)' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Label
              </label>
              <select
                value={newLabel}
                onChange={(e) => {
                  const lbl = e.target.value;
                  setNewLabel(lbl);
                  setNewCredits(lbl === 'Advanced' ? 5 : 1);
                }}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--a-line)' }}
              >
                <option value="Standard">Standard</option>
                <option value="Advanced">Advanced</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Credits per reply
              </label>
              <input
                type="number"
                min="0"
                value={newCredits}
                onChange={(e) => setNewCredits(Number(e.target.value))}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--a-line)' }}
              />
            </div>
          </div>

          <div style={{ marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn"
              disabled={testingNewModel}
              onClick={handleTestNewModel}
            >
              {testingNewModel ? 'Testing...' : 'Test model'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={addingModel}
              onClick={() => handleAddModel('hidden')}
            >
              Save as hidden
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={addingModel}
              onClick={() => handleAddModel('active')}
            >
              {addingModel ? 'Saving...' : 'Add model'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setShowAddForm(false)}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {/* Card: Models */}
      <section className="card" style={{ padding: '20px' }}>
        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 4px 0' }}>Models</h3>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--a-line)' }}>
                <th style={{ padding: '10px 12px' }}>Model</th>
                <th style={{ padding: '10px 12px' }}>Label</th>
                <th style={{ padding: '10px 12px' }}>Credits per reply</th>
                <th style={{ padding: '10px 12px' }}>Available on</th>
                <th style={{ padding: '10px 12px' }}>Status</th>
                <th style={{ padding: '10px 12px' }}>Default</th>
                {isAdmin && <th style={{ padding: '10px 12px', textAlign: 'right' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {models.map((m) => {
                const isEditing = editingModelId === m.id;
                const isSaving = savingModel === m.id;
                const plansList = Array.isArray(m.plans) ? m.plans : ['pro', 'enterprise'];

                return (
                  <tr key={m.id} style={{ borderBottom: '1px solid var(--a-line)' }}>
                    {/* Model name, provider badge, model ID */}
                    <td style={{ padding: '12px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontWeight: 600 }}>{m.name}</span>
                          <span className="badge" style={{ textTransform: 'capitalize' }}>
                            {m.provider}
                          </span>
                        </div>
                        <code style={{ fontSize: '12px', color: 'var(--a-muted)' }}>{m.modelId}</code>
                      </div>
                    </td>

                    {/* Label (editable) */}
                    <td style={{ padding: '12px' }}>
                      {isEditing ? (
                        <select
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--a-line)' }}
                        >
                          <option value="Standard">Standard</option>
                          <option value="Advanced">Advanced</option>
                        </select>
                      ) : (
                        <span className={`badge ${m.label.toLowerCase() === 'advanced' ? 'badge-warn' : 'badge-ok'}`}>
                          {m.label}
                        </span>
                      )}
                    </td>

                    {/* Credits per reply (editable number) */}
                    <td style={{ padding: '12px' }}>
                      {isEditing ? (
                        <input
                          type="number"
                          min="0"
                          value={editCredits}
                          onChange={(e) => setEditCredits(Number(e.target.value))}
                          style={{ width: '70px', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--a-line)' }}
                        />
                      ) : (
                        <b>{m.creditsPerReply}</b>
                      )}
                    </td>

                    {/* Available on (toggles Pro / Enterprise) */}
                    <td style={{ padding: '12px' }}>
                      {isEditing ? (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                            <input
                              type="checkbox"
                              checked={editPlans.includes('pro')}
                              onChange={(e) => {
                                if (e.target.checked) setEditPlans([...editPlans, 'pro']);
                                else setEditPlans(editPlans.filter((p) => p !== 'pro'));
                              }}
                            />
                            Pro
                          </label>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                            <input
                              type="checkbox"
                              checked={editPlans.includes('enterprise')}
                              onChange={(e) => {
                                if (e.target.checked) setEditPlans([...editPlans, 'enterprise']);
                                else setEditPlans(editPlans.filter((p) => p !== 'enterprise'));
                              }}
                            />
                            Enterprise
                          </label>
                        </div>
                      ) : (
                        <span style={{ fontSize: '13px' }}>
                          {plansList.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' / ') || 'None'}
                        </span>
                      )}
                    </td>

                    {/* Status (Active / Hidden / Retired) */}
                    <td style={{ padding: '12px' }}>
                      {isEditing ? (
                        <select
                          value={editStatus}
                          onChange={(e) => setEditStatus(e.target.value)}
                          style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--a-line)' }}
                        >
                          <option value="active">Active</option>
                          <option value="hidden">Hidden</option>
                          <option value="retired">Retired</option>
                        </select>
                      ) : (
                        <span
                          className={`badge ${
                            m.status === 'active' ? 'badge-ok' : m.status === 'hidden' ? 'badge-warn' : 'badge-bad'
                          }`}
                        >
                          {m.status.charAt(0).toUpperCase() + m.status.slice(1)}
                        </span>
                      )}
                    </td>

                    {/* Default (radio) */}
                    <td style={{ padding: '12px' }}>
                      <input
                        type="radio"
                        name="default-model"
                        checked={m.isDefault}
                        disabled={!isAdmin || isSaving}
                        onChange={() => handleSetDefault(m)}
                        aria-label={`Set ${m.name} as default model`}
                      />
                    </td>

                    {/* Actions */}
                    {isAdmin && (
                      <td style={{ padding: '12px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '6px' }}>
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-primary"
                                disabled={isSaving}
                                onClick={() => handleSaveModelEdit(m.id)}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="btn"
                                onClick={() => setEditingModelId(null)}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="btn"
                              onClick={() => {
                                setEditingModelId(m.id);
                                setEditLabel(m.label);
                                setEditCredits(m.creditsPerReply);
                                setEditPlans(plansList);
                                setEditStatus(m.status);
                              }}
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="sub" style={{ marginTop: '16px', fontSize: '13px' }}>
          A new price applies to replies from now on; past replies keep the price they were charged. Retiring a model moves tenants on it to the default and tells their owners.
        </p>
      </section>

      {/* Card: Providers */}
      <section className="card" style={{ padding: '20px' }}>
        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 4px 0' }}>Providers</h3>
          <p className="sub" style={{ margin: 0 }}>Platform keys used for the models above.</p>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--a-line)' }}>
              <th style={{ padding: '10px 12px' }}>Provider</th>
              <th style={{ padding: '10px 12px' }}>Status</th>
              <th style={{ padding: '10px 12px' }}>Key</th>
              <th style={{ padding: '10px 12px' }}>Test status</th>
              {isAdmin && <th style={{ padding: '10px 12px', textAlign: 'right' }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {providerDisplayList.map((p) => {
              const isEditing = editingProvider === p.key;
              const isTesting = testingProvider === p.key;

              return (
                <tr key={p.key} style={{ borderBottom: '1px solid var(--a-line)' }}>
                  <td style={{ padding: '12px', fontWeight: 600 }}>{p.displayName}</td>
                  <td style={{ padding: '12px' }}>
                    <span className={`badge ${p.status === 'Working' ? 'badge-ok' : 'badge-muted'}`}>
                      {p.status}
                    </span>
                  </td>
                  <td style={{ padding: '12px' }}>
                    {p.hasSecret ? (
                      <code>{p.maskedSecret || '••••3f9a'}</code>
                    ) : (
                      <span style={{ color: 'var(--a-muted)' }}>Not configured</span>
                    )}
                  </td>
                  <td style={{ padding: '12px', fontSize: '13px', color: 'var(--a-muted)' }}>
                    {p.hasSecret ? formatLastTested(p.lastTestedAt) : '–'}
                  </td>
                  {isAdmin && (
                    <td style={{ padding: '12px', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '8px' }}>
                        {p.hasSecret && (
                          <button
                            type="button"
                            className="btn"
                            disabled={isTesting}
                            onClick={() => handleTestProvider(p.key)}
                          >
                            {isTesting ? 'Testing...' : 'Test'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn"
                          onClick={() => {
                            setEditingProvider(isEditing ? null : p.key);
                            setProviderKey('');
                            setProviderBaseUrl(p.baseUrl || '');
                          }}
                        >
                          {isEditing ? 'Cancel' : p.hasSecret ? 'Replace key' : 'Set up'}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Configure Key Form */}
        {editingProvider && isAdmin && (
          <div
            style={{
              marginTop: '16px',
              padding: '16px',
              background: 'var(--a-bg)',
              borderRadius: '8px',
              border: '1px solid var(--a-line)',
            }}
          >
            <h4 style={{ margin: '0 0 12px 0' }}>Configure {editingProvider.toUpperCase()} Key</h4>
            <div style={{ display: 'grid', gap: '12px', maxWidth: '500px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}>
                  API Key (Stored with AES-256-GCM encryption)
                </label>
                <input
                  type="password"
                  placeholder={editingProvider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
                  value={providerKey}
                  onChange={(e) => setProviderKey(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--a-line)' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '4px' }}>
                  Base URL (Optional)
                </label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={providerBaseUrl}
                  onChange={(e) => setProviderBaseUrl(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--a-line)' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={savingProvider === editingProvider || !providerKey.trim()}
                  onClick={() => handleSaveProvider(editingProvider)}
                >
                  {savingProvider === editingProvider ? 'Testing & Saving...' : 'Save key'}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setEditingProvider(null);
                    setProviderKey('');
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
