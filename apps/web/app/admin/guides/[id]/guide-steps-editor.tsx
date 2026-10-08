'use client';

import { useEffect, useRef, useState } from 'react';
import type { AdminStep, FlowItem, FlowRun } from '@/lib/server-api';
import { formatRunDateTime } from '../../flows/flow-format';

function EyeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

export function isStepChanged(s: AdminStep, saved?: AdminStep): boolean {
  if (!saved) return true;
  if ((s.title ?? '') !== (saved.title ?? '')) return true;
  if (s.instruction !== saved.instruction) return true;
  if ((s.alt ?? '') !== (saved.alt ?? '')) return true;
  if (Boolean(s.hidden) !== Boolean(saved.hidden)) return true;
  if (Boolean(s.box) !== Boolean(saved.box)) return true;
  if (s.box && saved.box) {
    if (
      s.box.x !== saved.box.x ||
      s.box.y !== saved.box.y ||
      s.box.w !== saved.box.w ||
      s.box.h !== saved.box.h
    ) {
      return true;
    }
  }
  return false;
}

export type StepSaveResult = {
  ok: boolean;
  savedIds: string[];
  failedId?: string;
  error?: string;
};

export async function saveChangedSteps(
  publicId: string,
  steps: AdminStep[],
  savedSteps: AdminStep[],
  fetchFn: typeof fetch = fetch,
): Promise<StepSaveResult> {
  const savedMap = new Map(savedSteps.map((s) => [s.id, s]));
  const changed = steps.filter((s) => isStepChanged(s, savedMap.get(s.id)));
  if (changed.length === 0) return { ok: true, savedIds: [] };

  const savedIds: string[] = [];

  for (const step of changed) {
    try {
      const payload = {
        title: step.title ?? null,
        instruction: step.instruction,
        alt: step.alt ?? null,
        box: step.box,
        hidden: Boolean(step.hidden),
      };

      const res = await fetchFn(`/api/v1/flows/${publicId}/steps/${step.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorJson = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        const msg = errorJson?.error?.message ?? `Failed to save step ${step.order}`;
        return { ok: false, savedIds, failedId: step.id, error: msg };
      }

      savedIds.push(step.id);
    } catch {
      return {
        ok: false,
        savedIds,
        failedId: step.id,
        error: `Network error while saving step ${step.order}`,
      };
    }
  }

  return { ok: true, savedIds };
}

type Props = {
  guide: FlowItem;
  initialSteps: AdminStep[];
  runs?: FlowRun[];
  onCanSaveChange?: (canSave: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
  onStatusChange?: (status: string | null) => void;
  registerSave?: (saveFn: () => Promise<void>) => void;
};

export function GuideStepsEditor({
  guide,
  initialSteps,
  runs = [],
  onCanSaveChange,
  onSavingChange,
  onStatusChange,
  registerSave,
}: Props) {
  const [steps, setSteps] = useState<AdminStep[]>(initialSteps);
  const [savedSteps, setSavedSteps] = useState<AdminStep[]>(initialSteps);
  const [selectedId, setSelectedId] = useState<string | null>(initialSteps[0]?.id ?? null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [reRecordCopied, setReRecordCopied] = useState(false);

  const selectedStep = steps.find((s) => s.id === selectedId) ?? null;

  // Selected step edit state
  const [title, setTitle] = useState(selectedStep?.title ?? '');
  const [instruction, setInstruction] = useState(selectedStep?.instruction ?? '');
  const [alt, setAlt] = useState(selectedStep?.alt ?? '');
  const [hasHighlight, setHasHighlight] = useState(Boolean(selectedStep?.box));
  const [savedBox, setSavedBox] = useState<{ x: number; y: number; w: number; h: number } | null>(
    selectedStep?.box ?? null,
  );

  const selectStep = (step: AdminStep) => {
    const current = steps.find((s) => s.id === step.id) ?? step;
    setSelectedId(current.id);
    setTitle(current.title ?? '');
    setInstruction(current.instruction);
    setAlt(current.alt ?? '');
    setHasHighlight(Boolean(current.box));
    setSavedBox(current.box ?? savedBox);
    setStatus(null);
    setError(null);
    setConfirmingDelete(false);
    setReRecordCopied(false);
  };

  const updateCurrentStep = (patch: Partial<AdminStep>) => {
    if (!selectedId) return;
    setSteps((current) =>
      current.map((s) => (s.id === selectedId ? { ...s, ...patch } : s)),
    );
  };

  const handleTitleChange = (val: string) => {
    setTitle(val);
    updateCurrentStep({ title: val.length === 0 ? null : val });
  };

  const handleInstructionChange = (val: string) => {
    setInstruction(val);
    updateCurrentStep({ instruction: val });
  };

  const handleAltChange = (val: string) => {
    setAlt(val);
    updateCurrentStep({ alt: val.length === 0 ? null : val });
  };

  const handleHighlightToggle = (checked: boolean) => {
    setHasHighlight(checked);
    const box = checked ? (selectedStep?.box ?? savedBox) : null;
    updateCurrentStep({ box });
  };

  const toggleStepHidden = (stepId: string) => {
    setSteps((current) =>
      current.map((s) => (s.id === stepId ? { ...s, hidden: !s.hidden } : s)),
    );
  };

  const savedStepsById = new Map(savedSteps.map((s) => [s.id, s]));
  const changedSteps = steps.filter((s) => isStepChanged(s, savedStepsById.get(s.id)));
  const hasChanges = changedSteps.length > 0;
  const allChangedValid = changedSteps.every(
    (s) =>
      s.instruction.trim().length > 0 &&
      s.instruction.length <= 1000 &&
      (s.title ?? '').length <= 120 &&
      (s.alt ?? '').length <= 300,
  );
  const canSave = !saving && hasChanges && allChangedValid;

  useEffect(() => {
    onCanSaveChange?.(canSave);
  }, [canSave, onCanSaveChange]);

  useEffect(() => {
    onSavingChange?.(saving);
  }, [saving, onSavingChange]);

  useEffect(() => {
    onStatusChange?.(error ? `Error: ${error}` : status);
  }, [status, error, onStatusChange]);

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    setError(null);

    const result = await saveChangedSteps(guide.public_id, steps, savedSteps);

    if (!result.ok) {
      setError(result.error ?? 'Failed to save');
      setStatus(`Error: ${result.error ?? 'Failed to save'}`);
      if (result.savedIds.length > 0) {
        const savedIdSet = new Set(result.savedIds);
        const stepsById = new Map(steps.map((s) => [s.id, s]));
        setSavedSteps((prev) =>
          prev.map((s) => (savedIdSet.has(s.id) ? (stepsById.get(s.id) ?? s) : s)),
        );
      }
      setSaving(false);
      return;
    }

    setSavedSteps(steps);
    setStatus('Saved');
    setSaving(false);
  };

  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  useEffect(() => {
    registerSave?.(() => handleSaveRef.current());
  }, [registerSave]);

  const handleReRecord = async () => {
    if (!selectedStep) return;
    const prompt = `Re-record step ${selectedStep.order} of "${guide.title}": ${selectedStep.instruction}`;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(prompt);
      }
      setReRecordCopied(true);
      setStatus('Prompt copied to clipboard');
      setTimeout(() => setReRecordCopied(false), 3000);
    } catch {
      setStatus('Prompt copied');
    }
  };

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    if (reordering) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= steps.length) return;

    const newSteps = [...steps];
    const item = newSteps[index];
    newSteps[index] = newSteps[targetIndex];
    newSteps[targetIndex] = item;

    // Optimistically update order numbers
    const reorderedSteps = newSteps.map((s, idx) => ({ ...s, order: idx + 1 }));
    setSteps(reorderedSteps);
    setReordering(true);
    setError(null);

    try {
      const response = await fetch(`/api/v1/flows/${guide.public_id}/steps/reorder`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          step_ids: reorderedSteps.map((s) => s.id),
        }),
      });

      if (!response.ok) {
        setSteps(steps);
        setError('Failed to reorder steps');
      } else {
        setSavedSteps((prev) => {
          const map = new Map(reorderedSteps.map((s) => [s.id, s.order]));
          return prev
            .map((s) => ({ ...s, order: map.get(s.id) ?? s.order }))
            .sort((a, b) => a.order - b.order);
        });
      }
    } catch {
      setSteps(steps);
      setError('Network error while reordering steps');
    } finally {
      setReordering(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedStep) return;
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/v1/flows/${guide.public_id}/steps/${selectedStep.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        setError('Failed to delete step');
        setSaving(false);
        return;
      }

      const remainingSteps = steps
        .filter((s) => s.id !== selectedStep.id)
        .map((s, idx) => ({ ...s, order: idx + 1 }));

      setSteps(remainingSteps);
      setSavedSteps((prev) =>
        prev
          .filter((s) => s.id !== selectedStep.id)
          .map((s, idx) => ({ ...s, order: idx + 1 })),
      );
      setConfirmingDelete(false);

      if (remainingSteps.length > 0) {
        selectStep(remainingSteps[0]);
      } else {
        setSelectedId(null);
      }
    } catch {
      setError('Network error while deleting step');
    } finally {
      setSaving(false);
    }
  };

  const currentBox = hasHighlight ? (selectedStep?.box ?? savedBox) : null;
  const imageWidth = selectedStep?.image.width ?? 1;
  const imageHeight = selectedStep?.image.height ?? 1;

  const displayRuns: FlowRun[] =
    runs && runs.length > 0
      ? runs
      : [
          {
            id: 'current',
            started_at: guide.last_run_at || new Date().toISOString(),
            compiled_at: guide.last_run_at || null,
            status: 'compiled',
            step_count: steps.length,
            cli_version: null,
            is_current: true,
          },
        ];

  return (
    <div className="split" style={{ gridTemplateColumns: 'minmax(0, 0.8fr) minmax(0, 1.2fr)', gap: 18 }}>
      {/* Left column: Step list + History card (UI-A16 Finding 1 & 8) */}
      <div className="stack">
        <div className="card">
          <h3>
            {steps.length} {steps.length === 1 ? 'step' : 'steps'}
          </h3>
          {error && (
            <p className="msg bad" style={{ marginTop: 8 }}>
              {error}
            </p>
          )}
          {steps.length === 0 ? (
            <p className="sub" style={{ marginTop: 8 }}>
              No steps in this guide.
            </p>
          ) : (
            <ul className="adm-step-list" style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
              {steps.map((step, idx) => {
                const isSelected = step.id === selectedId;
                const cleanSubtitle = step.instruction.replace(/\*\*/g, '');
                const maskedCount = step.masked_count ?? 0;

                return (
                  <li
                    key={step.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
                      borderRadius: 6,
                      background: isSelected ? 'var(--a-soft, #e2f1eb)' : 'transparent',
                      border: isSelected
                        ? '1px solid var(--a-brand, #0f766e)'
                        : '1px solid var(--a-line, #dde4e0)',
                      cursor: 'pointer',
                      opacity: step.hidden ? 0.6 : 1,
                      transition: 'background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease',
                    }}
                    onClick={() => selectStep(step)}
                  >
                    {/* Reorder buttons with comfortable touch target (UI-A16 Finding 14) */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '3px 8px', fontSize: 13, minWidth: 26, minHeight: 24, lineHeight: 1 }}
                        disabled={idx === 0 || reordering}
                        aria-label={`Move step ${step.order} up`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMove(idx, 'up');
                        }}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '3px 8px', fontSize: 13, minWidth: 26, minHeight: 24, lineHeight: 1 }}
                        disabled={idx === steps.length - 1 || reordering}
                        aria-label={`Move step ${step.order} down`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMove(idx, 'down');
                        }}
                      >
                        ▼
                      </button>
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b style={{ display: 'block', fontSize: 14 }}>
                        {step.order}. {step.title || `Step ${step.order}`}
                        {step.hidden && (
                          <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 400, color: 'var(--a-muted, #5a6963)' }}>
                            (Hidden)
                          </span>
                        )}
                      </b>
                      {/* Subtitle with ** stripped (UI-A16 Finding 4) */}
                      <small
                        style={{
                          display: 'block',
                          color: 'var(--a-muted, #5a6963)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {cleanSubtitle}
                      </small>
                      {/* Masked fields information (UI-A16 Finding 3) */}
                      {maskedCount > 0 && (
                        <small className="sub" style={{ display: 'block', fontSize: 12 }}>
                          {maskedCount} {maskedCount === 1 ? 'field masked' : 'fields masked'}
                        </small>
                      )}
                    </div>

                    {step.box && (
                      <span className="badge" style={{ fontSize: 11, padding: '2px 6px' }}>
                        Highlight
                      </span>
                    )}

                    {/* Shown/Hidden toggle (UI-A16 Finding 2) */}
                    <button
                      type="button"
                      className={`btn ${step.hidden ? 'btn-muted' : ''}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '4px 8px',
                        fontSize: 12,
                        minHeight: 28,
                        lineHeight: 1,
                      }}
                      aria-label={`Show step ${step.order}`}
                      aria-pressed={!step.hidden}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleStepHidden(step.id);
                      }}
                    >
                      {step.hidden ? <EyeOffIcon /> : <EyeIcon />}
                      <span>{step.hidden ? 'Hidden' : 'Shown'}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* History card on Steps tab (UI-A16 Finding 1 & 8) */}
        <div className="card">
          <h3>History</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'grid', gap: 10 }}>
            {displayRuns.map((run) => (
              <li
                key={run.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: 'var(--a-bg, #f5f7f6)',
                  border: '1px solid var(--a-line, #dde4e0)',
                  fontSize: 13,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <b style={{ fontSize: 13 }}>{formatRunDateTime(run.started_at) || 'Recording session'}</b>
                  <span
                    className={`badge ${run.is_current || run.status === 'compiled' ? 'badge-ok' : 'badge-muted'}`}
                    style={{ fontSize: 11, padding: '1px 6px' }}
                  >
                    {run.is_current || run.status === 'compiled' ? 'published' : 'not published'}
                  </span>
                </div>
                <div style={{ color: 'var(--a-muted, #5a6963)', fontSize: 12 }}>
                  {run.cli_version ? `Recorded via CLI ${run.cli_version}` : 'Recording'}, {run.step_count}{' '}
                  {run.step_count === 1 ? 'step' : 'steps'}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Right column: Edit step */}
      <div className="card">
        {selectedStep ? (
          <div className="stack" style={{ gap: 14 }}>
            {/* Editor heading with shown/hidden toggle (UI-A16 Finding 2 & 11) */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Edit step</h3>
              <button
                type="button"
                className={`btn ${selectedStep.hidden ? 'btn-muted' : ''}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}
                aria-label={`Show step ${selectedStep.order}`}
                aria-pressed={!selectedStep.hidden}
                onClick={() => toggleStepHidden(selectedStep.id)}
              >
                {selectedStep.hidden ? <EyeOffIcon /> : <EyeIcon />}
                <span>{selectedStep.hidden ? 'Hidden' : 'Shown'}</span>
              </button>
            </div>

            {/* Title field without helper copy (UI-A16 Finding 10) */}
            <div className="fld">
              <label htmlFor="step-title">Title</label>
              <input
                id="step-title"
                type="text"
                value={title}
                maxLength={120}
                placeholder="Short step title (optional)"
                onChange={(e) => handleTitleChange(e.target.value)}
              />
            </div>

            <div className="fld">
              <label htmlFor="step-instruction">Instruction</label>
              <textarea
                id="step-instruction"
                rows={3}
                value={instruction}
                onChange={(e) => handleInstructionChange(e.target.value)}
              />
              <small className="sub">
                Put <b>**bold**</b> around the label the reader must click.
              </small>
            </div>

            {/* Image description field without helper copy (UI-A16 Finding 10) */}
            <div className="fld">
              <label htmlFor="step-alt">Image description</label>
              <input
                id="step-alt"
                type="text"
                value={alt}
                maxLength={300}
                placeholder="What the screenshot shows (optional)"
                onChange={(e) => handleAltChange(e.target.value)}
              />
            </div>

            {/* Screenshot preview or placeholder state (UI-A16 Finding 7) */}
            {selectedStep.image.url ? (
              <div
                style={{
                  position: 'relative',
                  marginTop: 8,
                  borderRadius: 6,
                  overflow: 'hidden',
                  border: '1px solid var(--a-line, #dde4e0)',
                }}
              >
                <img
                  src={selectedStep.image.url}
                  alt={selectedStep.alt || `Step ${selectedStep.order}`}
                  style={{ display: 'block', width: '100%', maxHeight: 240, objectFit: 'contain' }}
                />
                {currentBox && (
                  <span
                    style={{
                      position: 'absolute',
                      left: `${(currentBox.x / imageWidth) * 100}%`,
                      top: `${(currentBox.y / imageHeight) * 100}%`,
                      width: `${(currentBox.w / imageWidth) * 100}%`,
                      height: `${(currentBox.h / imageHeight) * 100}%`,
                      border: '3px solid #ffc83d',
                      borderRadius: 6,
                      boxShadow: '0 0 0 5px rgba(255,200,61,.35)',
                      pointerEvents: 'none',
                    }}
                  />
                )}
              </div>
            ) : (
              <div
                style={{
                  position: 'relative',
                  marginTop: 8,
                  height: 150,
                  borderRadius: 6,
                  border: '1px dashed var(--a-line, #dde4e0)',
                  background: 'var(--a-soft, #e2f1eb)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  overflow: 'hidden',
                }}
              >
                <span className="sub" style={{ fontSize: 13 }}>
                  No screenshot available for this step
                </span>
                {currentBox && (
                  <span
                    style={{
                      position: 'absolute',
                      left: `${Math.min(Math.max((currentBox.x / 1280) * 100, 10), 80)}%`,
                      top: `${Math.min(Math.max((currentBox.y / 800) * 100, 15), 65)}%`,
                      width: '80px',
                      height: '36px',
                      border: '3px solid #ffc83d',
                      borderRadius: 6,
                      boxShadow: '0 0 0 5px rgba(255,200,61,.35)',
                      pointerEvents: 'none',
                    }}
                  />
                )}
              </div>
            )}

            {/* Masked-field information & highlight target (UI-A16 Finding 3) */}
            {(() => {
              const boldMatch = selectedStep.instruction.match(/\*\*(.*?)\*\*/);
              const targetLabel = boldMatch ? boldMatch[1] : selectedStep.title || null;
              const maskedCount = selectedStep.masked_count ?? 0;
              return (
                <div style={{ fontSize: 13, color: 'var(--a-muted, #5a6963)' }}>
                  {hasHighlight && targetLabel ? (
                    <span>
                      Highlight on <b>{targetLabel}</b>.{' '}
                    </span>
                  ) : hasHighlight ? (
                    <span>Highlight active.{' '}</span>
                  ) : null}
                  <span>
                    {maskedCount > 0
                      ? `${maskedCount} ${maskedCount === 1 ? 'field masked' : 'fields masked'}`
                      : 'No fields masked'}
                  </span>
                </div>
              );
            })()}

            {/* Switch toggle control (UI-A16 Finding 9) */}
            <div className="fld">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={hasHighlight}
                  onChange={(e) => handleHighlightToggle(e.target.checked)}
                />
                <span>Show the highlight box</span>
              </label>
            </div>

            {/* Action buttons with Re-record and Delete (UI-A16 Finding 5) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn"
                  disabled={saving}
                  onClick={handleReRecord}
                >
                  {reRecordCopied ? 'Prompt copied!' : 'Re-record this step'}
                </button>

                {!confirmingDelete ? (
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={saving}
                    onClick={() => setConfirmingDelete(true)}
                  >
                    Delete step
                  </button>
                ) : (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span className="sub" style={{ fontSize: 13 }}>
                      Delete step {selectedStep.order}?
                    </span>
                    <button type="button" className="btn btn-danger" disabled={saving} onClick={handleDelete}>
                      Confirm delete
                    </button>
                    <button type="button" className="btn" disabled={saving} onClick={() => setConfirmingDelete(false)}>
                      Cancel
                    </button>
                  </div>
                )}

                {status && <span className="msg ok">{status}</span>}
                {error && <span className="msg bad">{error}</span>}
              </div>
              <small className="sub">
                Re-record copies a prompt for your AI agent to redo only this step.
              </small>
            </div>
          </div>
        ) : (
          <p className="sub">Select a step on the left to edit.</p>
        )}
      </div>
    </div>
  );
}
