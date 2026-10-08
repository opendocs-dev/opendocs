'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import type { FlowItem, AdminCategory } from '@/lib/server-api';
import { apiErrorMessage } from '@/lib/api-error';
import { visibilityLabel, visibilityTone, publicLink, categoryOption } from '@/lib/guide-labels';
import { formatFlowDate } from '../flows/flow-format';

type Props = {
  guides: FlowItem[];
  categories: AdminCategory[];
  initialSelected?: string[];
};

type RowState = 'normal' | 'confirming_delete';

/**
 * Sorts guides grouped by category (Finding 13):
 * - Categorized guides first, grouped by their category.
 * - Categories follow the order of the categories list, then alphabetical by category name.
 * - Uncategorized guides (and those with AI-suggested categories) come after categorized guides.
 * - Within each category group, sorted by last updated descending, then title.
 */
export function sortGuidesByCategory(guides: FlowItem[], categories: AdminCategory[]): FlowItem[] {
  const categoryOrder = new Map<string, number>();
  categories.forEach((cat, index) => {
    categoryOrder.set(cat.id, index);
  });

  return [...guides].sort((a, b) => {
    const aCatId = a.category?.status !== 'suggested' && a.category?.id ? a.category.id : undefined;
    const bCatId = b.category?.status !== 'suggested' && b.category?.id ? b.category.id : undefined;

    const aHasCat = Boolean(aCatId);
    const bHasCat = Boolean(bCatId);

    if (aHasCat && !bHasCat) return -1;
    if (!aHasCat && bHasCat) return 1;

    if (aHasCat && bHasCat && aCatId && bCatId) {
      if (aCatId !== bCatId) {
        const aOrder = categoryOrder.has(aCatId) ? categoryOrder.get(aCatId)! : 999;
        const bOrder = categoryOrder.has(bCatId) ? categoryOrder.get(bCatId)! : 999;

        if (aOrder !== bOrder) {
          return aOrder - bOrder;
        }

        const aName = a.category?.name || '';
        const bName = b.category?.name || '';
        const nameComp = aName.localeCompare(bName);
        if (nameComp !== 0) return nameComp;
      }
    }

    const aTime = a.last_run_at ? new Date(a.last_run_at).getTime() : 0;
    const bTime = b.last_run_at ? new Date(b.last_run_at).getTime() : 0;
    if (bTime !== aTime) {
      return bTime - aTime;
    }

    return a.title.localeCompare(b.title);
  });
}

export function GuidesTable({ guides, categories, initialSelected }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelected || []));
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [categoryLoading, setCategoryLoading] = useState<string | null>(null);
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const categoryMenuRef = useRef<HTMLDivElement>(null);
  const [openRowMenu, setOpenRowMenu] = useState<string | null>(null);
  const rowMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!categoryMenuOpen && !openRowMenu) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (categoryMenuOpen && categoryMenuRef.current && !categoryMenuRef.current.contains(target)) {
        setCategoryMenuOpen(false);
      }
      if (openRowMenu && rowMenuRef.current && !rowMenuRef.current.contains(target)) {
        setOpenRowMenu(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCategoryMenuOpen(false);
        setOpenRowMenu(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [categoryMenuOpen, openRowMenu]);

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selected);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelected(newSelected);
  };

  const updateCategory = async (publicId: string, categoryId: string | null) => {
    setCategoryLoading(publicId);
    try {
      const response = await fetch(`/api/v1/flows/${publicId}/category`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ category_id: categoryId }),
      });

      if (response.ok) {
        setSaveStatus('Saved');
        setTimeout(() => setSaveStatus(null), 2000);
        router.refresh();
      } else {
        const body = await response.json();
        setSaveStatus(`Error: ${apiErrorMessage(body, 'Failed to update')}`);
      }
    } catch {
      setSaveStatus('Error: Failed to update');
    } finally {
      setCategoryLoading(null);
    }
  };

  const deleteGuide = async (publicId: string) => {
    try {
      const response = await fetch(`/api/v1/flows/${publicId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        setRowState({ ...rowState, [publicId]: 'normal' });
        router.refresh();
      } else {
        setSaveStatus('Error: Failed to delete guide');
      }
    } catch (err) {
      setSaveStatus('Error: Could not delete guide');
    }
  };

  const applyBulkCategory = async (categoryId: string | null) => {
    const ids = Array.from(selected);
    if (ids.length === 0 || ids.length > 50) return;

    setBulkLoading(true);
    try {
      const response = await fetch('/api/v1/flows/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ids,
          category_id: categoryId,
        }),
      });

      if (response.ok) {
        const result = (await response.json()) as { updated: number };
        setSaveStatus(`Updated ${result.updated} guide${result.updated !== 1 ? 's' : ''}`);
        setTimeout(() => setSaveStatus(null), 2000);
        setSelected(new Set());
        router.refresh();
      } else {
        const body = await response.json();
        setSaveStatus(`Error: ${apiErrorMessage(body, 'Failed to update')}`);
      }
    } catch {
      setSaveStatus('Error: Failed to update');
    } finally {
      setBulkLoading(false);
    }
  };

  const applyBulkVisibility = async (visibility: 'published' | 'draft') => {
    const ids = Array.from(selected);
    if (ids.length === 0 || ids.length > 50) return;

    setBulkLoading(true);
    try {
      const response = await fetch('/api/v1/flows/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ids,
          visibility,
        }),
      });

      if (response.ok) {
        const result = (await response.json()) as { updated: number };
        setSaveStatus(`Updated ${result.updated} guide${result.updated !== 1 ? 's' : ''}`);
        setTimeout(() => setSaveStatus(null), 2000);
        setSelected(new Set());
        router.refresh();
      } else {
        const body = await response.json();
        setSaveStatus(`Error: ${apiErrorMessage(body, 'Failed to update')}`);
      }
    } catch {
      setSaveStatus('Error: Failed to update');
    } finally {
      setBulkLoading(false);
    }
  };

  const sortedGuides = sortGuidesByCategory(guides, categories);

  return (
    <div className="card">
      {/* Bulk action bar (Finding 1: sticky above table, one-click buttons) */}
      {selected.size > 0 && (
        <div className="bulk-bar">
          <span>{selected.size} selected</span>
          {selected.size > 50 && <span className="muted">Select up to 50 guides</span>}

          <div className="bulk-menu-wrap" ref={categoryMenuRef}>
            <button
              type="button"
              className="btn"
              onClick={() => setCategoryMenuOpen(!categoryMenuOpen)}
              disabled={selected.size > 50 || bulkLoading}
              aria-haspopup="menu"
              aria-expanded={categoryMenuOpen}
            >
              Set category
            </button>
            {categoryMenuOpen && (
              <div className="bulk-menu" role="menu">
                <button
                  type="button"
                  className="bulk-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setCategoryMenuOpen(false);
                    applyBulkCategory(null);
                  }}
                >
                  Uncategorized
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    className="bulk-menu-item"
                    role="menuitem"
                    onClick={() => {
                      setCategoryMenuOpen(false);
                      applyBulkCategory(cat.id);
                    }}
                  >
                    {categoryOption(cat)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            className="btn"
            onClick={() => applyBulkVisibility('published')}
            disabled={selected.size > 50 || bulkLoading}
          >
            Publish
          </button>

          <button
            type="button"
            className="btn"
            onClick={() => applyBulkVisibility('draft')}
            disabled={selected.size > 50 || bulkLoading}
          >
            Move to draft
          </button>

          <button
            type="button"
            onClick={() => setSelected(new Set())}
            disabled={bulkLoading}
            className="btn"
          >
            Clear selection
          </button>
        </div>
      )}

      <div className="tw">
        <table>
          <thead>
            <tr>
              <th />
              <th>Title</th>
              <th>Category</th>
              <th className="num">Steps</th>
              <th>Status</th>
              <th>Updated</th>
              <th className="num">Views</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sortedGuides.map((guide) => {
              const state = rowState[guide.public_id] || 'normal';
              const link = publicLink(guide);

              return (
                <tr
                  key={guide.public_id}
                  className={state === 'confirming_delete' ? 'row-confirming' : ''}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(guide.public_id)}
                      onChange={() => toggleSelect(guide.public_id)}
                      aria-label={`Select guide: ${guide.title}`}
                    />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <Link href={`/admin/guides/${guide.public_id}`} className="guide-title">
                        {guide.title}
                      </Link>
                      {guide.not_redacted && <span className="badge">Not redacted</span>}
                    </div>
                  </td>
                  <td>
                    {state === 'normal' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                        <select
                          value={guide.category?.status === 'suggested' ? '' : (guide.category?.id || '')}
                          onChange={(e) => updateCategory(guide.public_id, e.target.value === '' ? null : e.target.value)}
                          disabled={categoryLoading === guide.public_id}
                          aria-label={`Category for ${guide.title}`}
                        >
                          <option value="">Uncategorized</option>
                          {categories.map((cat) => (
                            <option key={cat.id} value={cat.id}>
                              {categoryOption(cat)}
                            </option>
                          ))}
                        </select>
                        {guide.category?.status === 'suggested' && (
                          <button
                            type="button"
                            className="badge badge-ai"
                            onClick={() => updateCategory(guide.public_id, guide.category!.id)}
                            disabled={categoryLoading === guide.public_id}
                            title={`Accept suggested category: ${guide.category.name}`}
                            style={{ cursor: 'pointer', border: 0 }}
                          >
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                              <path d="M8 0l1.7 5.3L15 7l-5.3 1.7L8 14l-1.7-5.3L1 7l5.3-1.7L8 0z" />
                            </svg>
                            AI suggests {guide.category.name}
                          </button>
                        )}
                      </div>
                    ) : null}
                  </td>
                  <td className="num">{guide.steps || 0}</td>
                  <td>
                    <span className={`badge badge-${visibilityTone(guide.visibility)}`}>
                      {visibilityLabel(guide.visibility)}
                    </span>
                  </td>
                  <td>{formatFlowDate(guide.last_run_at)}</td>
                  <td className="num">{(guide.views ?? 0).toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>
                    {state === 'normal' ? (
                      <div
                        className="row-menu-wrap"
                        ref={openRowMenu === guide.public_id ? rowMenuRef : null}
                      >
                        <button
                          type="button"
                          className="row-menu-btn"
                          aria-haspopup="menu"
                          aria-expanded={openRowMenu === guide.public_id}
                          aria-label={`Actions for ${guide.title}`}
                          onClick={() =>
                            setOpenRowMenu(
                              openRowMenu === guide.public_id ? null : guide.public_id,
                            )
                          }
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 16 16"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <circle cx="3" cy="8" r="1.5" />
                            <circle cx="8" cy="8" r="1.5" />
                            <circle cx="13" cy="8" r="1.5" />
                          </svg>
                        </button>
                        {openRowMenu === guide.public_id && (
                          <div className="row-menu" role="menu">
                            {link && (
                              <a
                                href={link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="row-menu-item"
                                role="menuitem"
                                onClick={() => setOpenRowMenu(null)}
                              >
                                View
                              </a>
                            )}
                            <button
                              type="button"
                              className="row-menu-item text-danger"
                              role="menuitem"
                              onClick={() => {
                                setOpenRowMenu(null);
                                setRowState({
                                  ...rowState,
                                  [guide.public_id]: 'confirming_delete',
                                });
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="delete-confirm">
                        <span>
                          Delete <b>{guide.title}</b>? The link stops working immediately.
                        </span>
                        <button
                          type="button"
                          onClick={() => deleteGuide(guide.public_id)}
                          className="btn btn-danger"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setRowState({ ...rowState, [guide.public_id]: 'normal' })
                          }
                          className="btn"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {saveStatus && (
        <p role="status" className={`msg ${saveStatus.startsWith('Error') ? 'bad' : 'ok'}`}>
          {saveStatus}
        </p>
      )}
    </div>
  );
}
