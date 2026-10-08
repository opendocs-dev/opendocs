'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AdminCategory } from '@/lib/server-api';
import { apiErrorMessage } from '@/lib/api-error';
import { moveCategory, positionsFor, validateCategoryName } from '@/lib/category-order';

type Props = {
  categories: AdminCategory[];
  policy: 'suggest' | 'auto';
  canEditPolicy: boolean;
};

type RowState = 'normal' | 'editing' | 'confirming_delete';

export function CategoriesManager({ categories: initialCategories, policy: initialPolicy, canEditPolicy }: Props) {
  const router = useRouter();
  // Server data is the source of truth: router.refresh() re-renders with fresh props.
  const categories = initialCategories;
  const [policy, setPolicy] = useState(initialPolicy);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [editData, setEditData] = useState<Record<string, { name: string; description: string }>>({});
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [policySaving, setPolicySaving] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const activeCategoryIds = categories
    .filter((c) => c.status === 'active')
    .map((c) => c.id);

  const suggestedCategories = categories.filter((c) => c.status === 'suggested');
  const activeCategories = categories.filter((c) => c.status === 'active');

  const acceptCategory = async (id: string) => {
    setLoadingId(id);
    try {
      const response = await fetch(`/api/v1/categories/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'active' }),
      });

      if (response.ok) {
        setSaveStatus('Saved');
        setTimeout(() => setSaveStatus(null), 2000);
        router.refresh();
      } else {
        const body = await response.json();
        setSaveStatus(`Error: ${apiErrorMessage(body, 'Failed to accept')}`);
      }
    } catch {
      setSaveStatus('Error: Failed to accept');
    } finally {
      setLoadingId(null);
    }
  };

  const dismissCategory = async (id: string) => {
    setLoadingId(id);
    try {
      const response = await fetch(`/api/v1/categories/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        setRowState({ ...rowState, [id]: 'normal' });
        router.refresh();
      } else {
        setSaveStatus('Error: Failed to dismiss');
      }
    } catch {
      setSaveStatus('Error: Could not dismiss');
    } finally {
      setLoadingId(null);
    }
  };

  const startEdit = (id: string, name: string, description: string) => {
    setEditData({ ...editData, [id]: { name, description } });
    setRowState({ ...rowState, [id]: 'editing' });
  };

  const cancelEdit = (id: string) => {
    setRowState({ ...rowState, [id]: 'normal' });
  };

  const saveEdit = async (id: string) => {
    const data = editData[id];
    if (!data) return;

    const nameError = validateCategoryName(data.name);
    if (nameError) {
      setSaveStatus(`Error: ${nameError}`);
      return;
    }

    setLoadingId(id);
    try {
      const response = await fetch(`/api/v1/categories/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: data.name, description: data.description }),
      });

      if (response.ok) {
        setSaveStatus('Saved');
        setTimeout(() => setSaveStatus(null), 2000);
        setRowState({ ...rowState, [id]: 'normal' });
        router.refresh();
      } else {
        const body = await response.json();
        setSaveStatus(`Error: ${apiErrorMessage(body, 'Failed to save')}`);
      }
    } catch {
      setSaveStatus('Error: Failed to save');
    } finally {
      setLoadingId(null);
    }
  };

  const deleteCategory = async (id: string) => {
    setLoadingId(id);
    try {
      const response = await fetch(`/api/v1/categories/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        setRowState({ ...rowState, [id]: 'normal' });
        router.refresh();
      } else {
        setSaveStatus('Error: Failed to delete');
      }
    } catch {
      setSaveStatus('Error: Could not delete');
    } finally {
      setLoadingId(null);
    }
  };

  const moveUp = async (id: string) => {
    const newIds = moveCategory(activeCategoryIds, id, 'up');
    if (newIds === activeCategoryIds) return;

    setLoadingId(id);
    try {
      const positions = positionsFor(newIds);
      const responses = await Promise.all(
        positions.map((p) =>
          fetch(`/api/v1/categories/${p.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ position: p.position }),
          }),
        ),
      );

      if (responses.every((r) => r.ok)) {
        setSaveStatus('Saved');
        setTimeout(() => setSaveStatus(null), 2000);
        router.refresh();
      } else {
        setSaveStatus('Error: Failed to update order');
        router.refresh();
      }
    } catch {
      setSaveStatus('Error: Failed to update order');
      router.refresh();
    } finally {
      setLoadingId(null);
    }
  };

  const moveDown = async (id: string) => {
    const newIds = moveCategory(activeCategoryIds, id, 'down');
    if (newIds === activeCategoryIds) return;

    setLoadingId(id);
    try {
      const positions = positionsFor(newIds);
      const responses = await Promise.all(
        positions.map((p) =>
          fetch(`/api/v1/categories/${p.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ position: p.position }),
          }),
        ),
      );

      if (responses.every((r) => r.ok)) {
        setSaveStatus('Saved');
        setTimeout(() => setSaveStatus(null), 2000);
        router.refresh();
      } else {
        setSaveStatus('Error: Failed to update order');
        router.refresh();
      }
    } catch {
      setSaveStatus('Error: Failed to update order');
      router.refresh();
    } finally {
      setLoadingId(null);
    }
  };

  const addCategory = async () => {
    const nameError = validateCategoryName(newName);
    if (nameError) {
      setSaveStatus(`Error: ${nameError}`);
      return;
    }

    setLoadingId('new');
    try {
      const response = await fetch('/api/v1/categories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: newName, description: newDescription }),
      });

      if (response.ok) {
        setSaveStatus('Saved');
        setTimeout(() => setSaveStatus(null), 2000);
        setNewName('');
        setNewDescription('');
        setShowAddForm(false);
        router.refresh();
      } else {
        const body = await response.json();
        setSaveStatus(`Error: ${apiErrorMessage(body, 'Failed to create')}`);
      }
    } catch {
      setSaveStatus('Error: Failed to create');
    } finally {
      setLoadingId(null);
    }
  };

  const updatePolicy = async (newPolicy: 'suggest' | 'auto') => {
    setPolicySaving(true);
    try {
      const response = await fetch('/api/v1/site/category-policy', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ policy: newPolicy }),
      });

      if (response.ok) {
        setPolicy(newPolicy);
        setSaveStatus('Saved');
        setTimeout(() => setSaveStatus(null), 2000);
      } else {
        const body = await response.json();
        setSaveStatus(`Error: ${apiErrorMessage(body, 'Failed to save')}`);
      }
    } catch {
      setSaveStatus('Error: Failed to save');
    } finally {
      setPolicySaving(false);
    }
  };

  return (
    <div className="stack">
      {/* Pane Header with Title and Primary Action */}
      <div className="adm-pane-header">
        <div>
          <h1>Categories</h1>
          <div className="sub">Group guides on your site and in search</div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowAddForm((v) => !v)}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M8 3v10M3 8h10" />
          </svg>
          New category
        </button>
      </div>

      {/* Two-column layout */}
      <div className="split">
        {/* Left Column: Categories and Suggestions */}
        <div className="stack">
          {/* Categories card */}
          <div className="card">
            <h2>Your categories</h2>
            <p className="sub">Categories help visitors browse related guides on your site.</p>
            {activeCategories.length === 0 ? (
              <p className="muted" style={{ marginTop: 12 }}>
                No categories yet.{' '}
                <button
                  type="button"
                  onClick={() => setShowAddForm(true)}
                  className="btn"
                  style={{ padding: '2px 8px', fontSize: '13px' }}
                >
                  Add one
                </button>
                , or let your agent suggest them.
              </p>
            ) : (
              <div className="cat-list">
                {activeCategories.map((cat, idx) => {
                  const state = rowState[cat.id] || 'normal';
                  const isFirst = idx === 0;
                  const isLast = idx === activeCategories.length - 1;

                  return (
                    <div key={cat.id}>
                      {state === 'normal' ? (
                        <div className="cat-row">
                          <span className="cat-grip" aria-hidden="true" title="Drag to reorder">
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                              <circle cx="7" cy="5" r="1.5" />
                              <circle cx="13" cy="5" r="1.5" />
                              <circle cx="7" cy="10" r="1.5" />
                              <circle cx="13" cy="10" r="1.5" />
                              <circle cx="7" cy="15" r="1.5" />
                              <circle cx="13" cy="15" r="1.5" />
                            </svg>
                          </span>
                          <div className="cat-info">
                            <div className="cat-name">{cat.name}</div>
                            <div className="cat-desc">
                              /c/{cat.slug}
                              {cat.description ? ` · ${cat.description}` : ''}
                            </div>
                          </div>
                          <span className="badge">
                            {cat.guides || 0} guide{cat.guides !== 1 ? 's' : ''}
                          </span>
                          <div className="cat-actions">
                            <button
                              type="button"
                              onClick={() => moveUp(cat.id)}
                              disabled={isFirst || loadingId !== null}
                              aria-label="Move up"
                              className="cat-move-btn"
                            >
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M8 2l4 4h-3v8H7V6H4l4-4z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => moveDown(cat.id)}
                              disabled={isLast || loadingId !== null}
                              aria-label="Move down"
                              className="cat-move-btn"
                            >
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M8 14l-4-4h3V2h2v8h3l-4 4z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => startEdit(cat.id, cat.name, cat.description || '')}
                              disabled={loadingId !== null}
                              className="btn"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setRowState({ ...rowState, [cat.id]: 'confirming_delete' })}
                              disabled={loadingId !== null}
                              className="btn btn-danger"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ) : state === 'editing' ? (
                        <div className="cat-edit">
                          <div className="fld">
                            <label>Name</label>
                            <input
                              type="text"
                              value={editData[cat.id]?.name || ''}
                              onChange={(e) =>
                                setEditData({
                                  ...editData,
                                  [cat.id]: { ...editData[cat.id]!, name: e.target.value },
                                })
                              }
                              maxLength={40}
                              disabled={loadingId !== null}
                            />
                          </div>
                          <div className="fld">
                            <label>Description (optional)</label>
                            <textarea
                              value={editData[cat.id]?.description || ''}
                              onChange={(e) =>
                                setEditData({
                                  ...editData,
                                  [cat.id]: { ...editData[cat.id]!, description: e.target.value },
                                })
                              }
                              maxLength={200}
                              disabled={loadingId !== null}
                            />
                          </div>
                          <div className="cat-edit-actions">
                            <button
                              type="button"
                              onClick={() => saveEdit(cat.id)}
                              disabled={loadingId !== null}
                              className="btn btn-primary"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => cancelEdit(cat.id)}
                              disabled={loadingId !== null}
                              className="btn"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="delete-confirm">
                          <span>
                            Delete &quot;<b>{cat.name}</b>&quot;? Its {cat.guides || 0} guide
                            {cat.guides !== 1 ? 's' : ''} become{cat.guides !== 1 ? '' : 's'} uncategorized.
                          </span>
                          <button
                            type="button"
                            onClick={() => deleteCategory(cat.id)}
                            disabled={loadingId !== null}
                            className="btn btn-danger"
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setRowState({ ...rowState, [cat.id]: 'normal' })}
                            disabled={loadingId !== null}
                            className="btn"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <p className="cnt" style={{ marginTop: 12 }}>
              {activeCategories.length} of 30 categories
            </p>
          </div>

          {/* Suggested by your agent card */}
          {suggestedCategories.length > 0 && (
            <div className="card cat-suggested">
              <h3>Suggested by your agent</h3>
              <p className="sub">New names your AI used that you have not approved yet.</p>
              <div className="cat-list">
                {suggestedCategories.map((cat) => (
                  <div key={cat.id} className="cat-row" style={{ background: 'var(--a-surface)' }}>
                    <span className="cat-sparkle" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 1.5l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5 1.5-4z" />
                      </svg>
                    </span>
                    <div className="cat-info">
                      <div className="cat-name">{cat.name}</div>
                      <div className="cat-desc">
                        {cat.guides || 0} guide{cat.guides !== 1 ? 's' : ''} waiting
                      </div>
                    </div>
                    <span className="badge badge-ai">From agent</span>
                    <div className="cat-actions">
                      <button
                        type="button"
                        onClick={() => acceptCategory(cat.id)}
                        disabled={loadingId !== null}
                        className="btn btn-primary"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => dismissCategory(cat.id)}
                        disabled={loadingId !== null}
                        className="btn"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: New Category Form and Policy */}
        <div className="stack">
          {/* New category form */}
          {showAddForm && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3>New category</h3>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowAddForm(false)}
                  aria-label="Close new category form"
                  style={{ padding: '4px 10px', fontSize: '13px' }}
                >
                  Cancel
                </button>
              </div>
              <p className="sub">Create a new category to organize your guides.</p>
              <div className="fld">
                <label>Name *</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={40}
                  placeholder="e.g., Getting Started"
                  disabled={loadingId !== null}
                />
                <small>{newName.length}/40</small>
              </div>
              <div className="fld">
                <label>Description (optional)</label>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  maxLength={200}
                  placeholder="What's this category for?"
                  disabled={loadingId !== null}
                />
                <small>{newDescription.length}/200</small>
              </div>
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  onClick={addCategory}
                  disabled={loadingId !== null || !newName.trim()}
                  className="btn btn-primary"
                >
                  Add
                </button>
              </div>
            </div>
          )}

          {/* Policy card */}
          <div className="card">
            <h3>When an agent sends a new category</h3>
            <p className="sub">Applies to every API key in this workspace.</p>
            {canEditPolicy ? (
              <div className="radio-group">
                <label className={`radio-label ${policy === 'suggest' ? 'checked' : ''}`}>
                  <input
                    type="radio"
                    name="policy"
                    value="suggest"
                    checked={policy === 'suggest'}
                    onChange={() => updatePolicy('suggest')}
                    disabled={policySaving}
                  />
                  <span>
                    <strong>Suggest it for review</strong>
                    <small>Review and accept suggestions in this view</small>
                  </span>
                </label>
                <label className={`radio-label ${policy === 'auto' ? 'checked' : ''}`}>
                  <input
                    type="radio"
                    name="policy"
                    value="auto"
                    checked={policy === 'auto'}
                    onChange={() => updatePolicy('auto')}
                    disabled={policySaving}
                  />
                  <span>
                    <strong>Create it automatically</strong>
                    <small>New categories appear right away</small>
                  </span>
                </label>
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                <p>
                  {policy === 'suggest'
                    ? 'Agent suggestions wait for your approval.'
                    : 'Categories from your agent are added automatically.'}
                </p>
                <p className="muted">Only owners and admins can change this.</p>
              </div>
            )}
          </div>

          {/* Status message */}
          {saveStatus && (
            <p role="alert" className={`msg ${saveStatus.startsWith('Error') ? 'bad' : 'ok'}`}>
              {saveStatus}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
