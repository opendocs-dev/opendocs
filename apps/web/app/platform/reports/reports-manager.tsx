'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import type { PlatformReportItem, PlatformReportsResponse } from '@/lib/server-api';

type Props = {
  initialReports: PlatformReportItem[];
  initialCounts: PlatformReportsResponse['counts'];
  currentRole: 'admin' | 'support';
  currentUserId: string;
};

const formatType = (rawType: string): string => {
  switch (rawType.toLowerCase().replace(/[-\s]/g, '_')) {
    case 'phishing':
      return 'Phishing';
    case 'copyright':
      return 'Copyright';
    case 'personal_data':
      return 'Personal data';
    case 'spam':
      return 'Spam';
    default:
      return rawType.charAt(0).toUpperCase() + rawType.slice(1);
  }
};

const formatBadge = (status: string): { label: string; className: string } => {
  switch (status.toLowerCase()) {
    case 'new':
      return { label: 'New', className: 'badge badge-warn' };
    case 'in_review':
      return { label: 'In review', className: 'badge badge-ai' };
    case 'actioned':
      return { label: 'Actioned', className: 'badge badge-ok' };
    case 'dismissed':
      return { label: 'Dismissed', className: 'badge' };
    default:
      return { label: status, className: 'badge' };
  }
};

const formatReportDate = (isoString: string): string => {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return 'recently';
  }
};

export function ReportsManager({
  initialReports,
  initialCounts,
  currentRole,
}: Props) {
  const router = useRouter();
  const noteId = useId();

  const [reports, setReports] = useState<PlatformReportItem[]>(initialReports);
  const [counts, setCounts] = useState(initialCounts);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(
    initialReports[0]?.id ?? null,
  );

  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const filteredReports = reports.filter((r) => {
    if (statusFilter === 'all') return true;
    return r.status === statusFilter;
  });

  // Keep selection valid when filter changes
  useEffect(() => {
    if (filteredReports.length > 0) {
      if (!selectedId || !filteredReports.some((r) => r.id === selectedId)) {
        setSelectedId(filteredReports[0]!.id);
      }
    } else {
      setSelectedId(null);
    }
  }, [statusFilter, filteredReports, selectedId]);

  const selectedReport = reports.find((r) => r.id === selectedId) ?? null;

  // Sync note input when selection changes
  useEffect(() => {
    if (selectedReport) {
      setNoteText(selectedReport.notes ?? '');
      setError(null);
      setSuccess(null);
    }
  }, [selectedReport?.id, selectedReport?.notes]);

  const selectedIdx = filteredReports.findIndex((r) => r.id === selectedId);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (filteredReports.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIdx = Math.min(selectedIdx + 1, filteredReports.length - 1);
      setSelectedId(filteredReports[nextIdx]!.id);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIdx = Math.max(selectedIdx - 1, 0);
      setSelectedId(filteredReports[prevIdx]!.id);
    }
  };

  const handleSaveNote = async () => {
    if (!selectedReport) return;
    setSavingNote(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/v1/platform/reports/${selectedReport.id}/notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notes: noteText }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message || 'Failed to save note');
        return;
      }
      setReports((prev) =>
        prev.map((r) => (r.id === selectedReport.id ? { ...r, notes: noteText } : r)),
      );
      setSuccess('Note saved to audit log.');
      router.refresh();
    } catch {
      setError('An unexpected error occurred while saving note');
    } finally {
      setSavingNote(false);
    }
  };

  const handleRevealEmail = async () => {
    if (!selectedReport) return;
    setError(null);
    try {
      const res = await fetch(`/api/v1/platform/reports/${selectedReport.id}/reveal-email`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message || 'Failed to reveal reporter email');
        return;
      }
      setReports((prev) =>
        prev.map((r) =>
          r.id === selectedReport.id
            ? {
                ...r,
                reporter_email: data.reporter_email,
                reporter_email_revealed: true,
              }
            : r,
        ),
      );
      setSuccess('Reporter email revealed and logged in audit log.');
    } catch {
      setError('Failed to reveal reporter email');
    }
  };

  const handleUnpublish = async () => {
    if (!selectedReport) return;
    if (currentRole !== 'admin') {
      setError('Platform admin role required to unpublish guides.');
      return;
    }
    const confirmed = window.confirm(
      `Unpublish guide at "${selectedReport.guide_address}"? It will immediately disappear from the reader site.`,
    );
    if (!confirmed) return;

    setActionLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(
        `/api/v1/platform/reports/${selectedReport.id}/actions/unpublish`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: noteText || 'Abuse report takedown' }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message || 'Failed to unpublish guide');
        return;
      }

      setReports((prev) =>
        prev.map((r) =>
          r.id === selectedReport.id
            ? { ...r, status: 'actioned', guide_visibility: 'draft' }
            : r,
        ),
      );
      setCounts((prev) => ({
        ...prev,
        actioned: prev.actioned + 1,
        new: selectedReport.status === 'new' ? Math.max(0, prev.new - 1) : prev.new,
        in_review:
          selectedReport.status === 'in_review'
            ? Math.max(0, prev.in_review - 1)
            : prev.in_review,
      }));
      setSuccess('Guide unpublished and report marked as actioned.');
      router.refresh();
    } catch {
      setError('An error occurred while unpublishing guide');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSuspend = async () => {
    if (!selectedReport) return;
    if (currentRole !== 'admin') {
      setError('Platform admin role required to suspend tenants.');
      return;
    }
    const confirmed = window.confirm(
      `Suspend tenant "${selectedReport.tenant_name}"? All guides under this workspace will be inaccessible.`,
    );
    if (!confirmed) return;

    setActionLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(
        `/api/v1/platform/reports/${selectedReport.id}/actions/suspend`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: noteText || 'Abuse report tenant suspension' }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message || 'Failed to suspend tenant');
        return;
      }

      setReports((prev) =>
        prev.map((r) =>
          r.id === selectedReport.id
            ? { ...r, status: 'actioned', tenant_status: 'suspended' }
            : r,
        ),
      );
      setCounts((prev) => ({
        ...prev,
        actioned: prev.actioned + 1,
        new: selectedReport.status === 'new' ? Math.max(0, prev.new - 1) : prev.new,
        in_review:
          selectedReport.status === 'in_review'
            ? Math.max(0, prev.in_review - 1)
            : prev.in_review,
      }));
      setSuccess('Tenant suspended and report marked as actioned.');
      router.refresh();
    } catch {
      setError('An error occurred while suspending tenant');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDismiss = async () => {
    if (!selectedReport) return;
    setActionLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(
        `/api/v1/platform/reports/${selectedReport.id}/actions/dismiss`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: noteText || 'Report dismissed' }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message || 'Failed to dismiss report');
        return;
      }

      setReports((prev) =>
        prev.map((r) => (r.id === selectedReport.id ? { ...r, status: 'dismissed' } : r)),
      );
      setCounts((prev) => ({
        ...prev,
        dismissed: prev.dismissed + 1,
        new: selectedReport.status === 'new' ? Math.max(0, prev.new - 1) : prev.new,
        in_review:
          selectedReport.status === 'in_review'
            ? Math.max(0, prev.in_review - 1)
            : prev.in_review,
      }));
      setSuccess('Report dismissed.');
      router.refresh();
    } catch {
      setError('An error occurred while dismissing report');
    } finally {
      setActionLoading(false);
    }
  };

  const subtitle = `${counts.new} new, ${counts.in_review} in review`;

  const guideHref = selectedReport?.guide_address
    ? selectedReport.guide_address.startsWith('http')
      ? selectedReport.guide_address
      : `https://${selectedReport.guide_address}`
    : '#';

  return (
    <div className="stack" onKeyDown={handleKeyDown} tabIndex={0} style={{ outline: 'none' }}>
      <div className="adm-pane-header">
        <div>
          <h1>Reports</h1>
          <div className="sub" style={{ marginTop: '2px' }}>
            <span>{subtitle}</span>. Abuse and takedown reports from readers or rights holders (phishing, copyright, exposed personal data, spam). Click a report to read it.
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div className="seg" role="tablist" aria-label="Filter reports by status">
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === 'all'}
            aria-pressed={statusFilter === 'all'}
            onClick={() => setStatusFilter('all')}
          >
            All ({counts.total})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === 'new'}
            aria-pressed={statusFilter === 'new'}
            onClick={() => setStatusFilter('new')}
          >
            New ({counts.new})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === 'in_review'}
            aria-pressed={statusFilter === 'in_review'}
            onClick={() => setStatusFilter('in_review')}
          >
            In review ({counts.in_review})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === 'actioned'}
            aria-pressed={statusFilter === 'actioned'}
            onClick={() => setStatusFilter('actioned')}
          >
            Actioned ({counts.actioned})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === 'dismissed'}
            aria-pressed={statusFilter === 'dismissed'}
            onClick={() => setStatusFilter('dismissed')}
          >
            Dismissed ({counts.dismissed})
          </button>
        </div>
      </div>

      {error && <p className="msg bad" role="alert">{error}</p>}
      {success && <p className="msg ok" role="status">{success}</p>}

      {filteredReports.length === 0 ? (
        <div className="card" style={{ padding: '32px', textAlign: 'center' }}>
          <p style={{ margin: 0, color: 'var(--a-muted)', fontSize: '15px' }}>
            No reports in queue
          </p>
          <p className="sub" style={{ marginTop: '4px' }}>
            All abuse and takedown reports in this view have been processed.
          </p>
        </div>
      ) : (
        <div className="split" style={{ alignItems: 'stretch' }}>
          {/* Left list (selectable rows) */}
          <div
            className="card"
            style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}
            role="listbox"
            aria-label="Abuse reports queue"
          >
            {filteredReports.map((r) => {
              const isSelected = r.id === selectedId;
              const badge = formatBadge(r.status);
              return (
                <div
                  key={r.id}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  onClick={() => setSelectedId(r.id)}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    background: isSelected ? 'var(--a-soft)' : 'transparent',
                    border: isSelected
                      ? '1px solid color-mix(in srgb, var(--a-brand) 40%, transparent)'
                      : '1px solid transparent',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    transition: 'all 0.1s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: '14px' }}>{formatType(r.type)}</span>
                    <span className={badge.className}>{badge.label}</span>
                  </div>
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '12.5px',
                      color: 'var(--a-ink)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {r.guide_address}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--a-muted)' }}>
                    <span>{r.tenant_name}</span>
                    <span>{formatReportDate(r.created_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right detail card */}
          {selectedReport && (
            <div className="card stack" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ fontSize: '1.25rem', marginBottom: '4px' }}>
                    {formatType(selectedReport.type)}
                  </h2>
                  <div style={{ fontSize: '13.5px', color: 'var(--a-muted)' }}>
                    Guide:{' '}
                    <a
                      href={guideHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--a-brand)', textDecoration: 'none', fontWeight: 500 }}
                    >
                      {selectedReport.guide_address}
                    </a>
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--a-muted)', marginTop: '2px' }}>
                    Tenant: <b>{selectedReport.tenant_name}</b>
                    {selectedReport.tenant_status === 'suspended' && (
                      <span className="badge badge-bad" style={{ marginLeft: '8px' }}>
                        Suspended
                      </span>
                    )}
                    {selectedReport.guide_visibility === 'draft' && (
                      <span className="badge" style={{ marginLeft: '8px' }}>
                        Unpublished
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <span className={formatBadge(selectedReport.status).className}>
                    {formatBadge(selectedReport.status).label}
                  </span>
                </div>
              </div>

              {/* Report text */}
              <div
                style={{
                  background: 'var(--a-bg)',
                  border: '1px solid var(--a-line)',
                  borderRadius: '8px',
                  padding: '14px',
                  fontSize: '14px',
                  lineHeight: '1.5',
                  color: 'var(--a-ink)',
                }}
              >
                {selectedReport.text}
              </div>

              {/* Reporter line */}
              <div style={{ fontSize: '13px', color: 'var(--a-muted)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span>
                  Reported by a reader, {formatReportDate(selectedReport.created_at)}{' '}
                  {selectedReport.reporter_email_revealed ? (
                    <b style={{ color: 'var(--a-ink)' }}>({selectedReport.reporter_email})</b>
                  ) : (
                    '(email hidden from staff by default).'
                  )}
                </span>
                {!selectedReport.reporter_email_revealed && (
                  <button
                    type="button"
                    onClick={handleRevealEmail}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: 'var(--a-brand)',
                      textDecoration: 'underline',
                      cursor: 'pointer',
                      fontSize: '13px',
                    }}
                  >
                    Reveal email
                  </button>
                )}
              </div>

              {/* Actions bar */}
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  paddingTop: '8px',
                  borderTop: '1px solid var(--a-line)',
                }}
              >
                <a
                  href={guideHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn"
                  style={{ textDecoration: 'none' }}
                >
                  Open guide
                </a>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleUnpublish}
                  disabled={currentRole !== 'admin' || actionLoading}
                  title={
                    currentRole !== 'admin'
                      ? 'Platform admin role required to unpublish guides'
                      : undefined
                  }
                >
                  Unpublish guide
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleSuspend}
                  disabled={currentRole !== 'admin' || actionLoading}
                  title={
                    currentRole !== 'admin'
                      ? 'Platform admin role required to suspend tenants'
                      : undefined
                  }
                >
                  Suspend tenant
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={handleDismiss}
                  disabled={actionLoading}
                >
                  Dismiss
                </button>
              </div>

              {/* Note field */}
              <div className="fld" style={{ marginTop: '4px' }}>
                <label htmlFor={noteId} className="lab">
                  Note (kept in the audit log)
                </label>
                <textarea
                  id={noteId}
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Add notes for the team or resolution record..."
                  rows={3}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleSaveNote}
                    disabled={savingNote}
                  >
                    {savingNote ? 'Saving...' : 'Save note'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
