'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { PlatformDomainItem } from '@/lib/server-api';
import { relativeTime } from '@/lib/relative-time';

type Props = {
  initialDomains: PlatformDomainItem[];
  total: number;
  initialFilter?: string;
  currentRole: 'admin' | 'support';
};

function formatCertDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '–';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function renderStatusBadge(status: string) {
  switch (status) {
    case 'verified':
      return <span className="badge badge-ok">Verified</span>;
    case 'waiting_dns':
      return <span className="badge badge-warn">Waiting for DNS</span>;
    case 'cert_failing':
      return <span className="badge badge-bad">Certificate failing</span>;
    case 'blocked':
      return <span className="badge badge-bad">Blocked</span>;
    default:
      return <span className="badge">{status}</span>;
  }
}

export function DomainsManager({
  initialDomains,
  total,
  initialFilter = 'all',
  currentRole,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [domains, setDomains] = useState<PlatformDomainItem[]>(initialDomains);
  const [filter, setFilter] = useState(initialFilter);
  const [recheckingDomain, setRecheckingDomain] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'bad'; message: string } | null>(null);

  // Confirmation modal state for block / unblock
  const [modal, setModal] = useState<{
    domain: string;
    action: 'block' | 'unblock';
  } | null>(null);
  const [modalReason, setModalReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const isAdmin = currentRole === 'admin';

  const handleFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextFilter = e.target.value;
    setFilter(nextFilter);
    startTransition(() => {
      const q = nextFilter && nextFilter !== 'all' ? `?filter=${encodeURIComponent(nextFilter)}` : '';
      router.push(`/platform/domains${q}`);
    });
  };

  const handleRecheck = async (domain: string) => {
    setRecheckingDomain(domain);
    setFeedback(null);

    try {
      const res = await fetch(`/api/v1/platform/domains/${encodeURIComponent(domain)}/recheck`, {
        method: 'POST',
      });
      const data = await res.json();

      if (!res.ok) {
        setFeedback({
          type: 'bad',
          message: data.error?.message || `Failed to recheck domain ${domain}`,
        });
        return;
      }

      setDomains((prev) =>
        prev.map((d) =>
          d.domain === domain
            ? {
                ...d,
                status: data.status,
                last_checked_at: data.last_checked_at,
              }
            : d,
        ),
      );
      setFeedback({
        type: 'ok',
        message: `Rechecked ${domain}: status is ${data.status.replace('_', ' ')}`,
      });
      router.refresh();
    } catch {
      setFeedback({ type: 'bad', message: 'An unexpected error occurred during recheck' });
    } finally {
      setRecheckingDomain(null);
    }
  };

  const openModal = (domain: string, action: 'block' | 'unblock') => {
    setModal({ domain, action });
    setModalReason('');
    setModalError(null);
  };

  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modal) return;
    if (!modalReason.trim()) {
      setModalError('A reason is required');
      return;
    }

    setIsSubmitting(true);
    setModalError(null);

    try {
      const res = await fetch(
        `/api/v1/platform/domains/${encodeURIComponent(modal.domain)}/${modal.action}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: modalReason.trim() }),
        },
      );
      const data = await res.json();

      if (!res.ok) {
        setModalError(data.error?.message || `Failed to ${modal.action} domain`);
        return;
      }

      const nextStatus = data.status;
      setDomains((prev) =>
        prev.map((d) =>
          d.domain === modal.domain
            ? {
                ...d,
                status: nextStatus,
                last_checked_at: data.last_checked_at ?? d.last_checked_at,
              }
            : d,
        ),
      );

      setFeedback({
        type: 'ok',
        message:
          modal.action === 'block'
            ? `Successfully blocked domain ${modal.domain}`
            : `Successfully unblocked domain ${modal.domain}`,
      });
      setModal(null);
      router.refresh();
    } catch {
      setModalError('An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="stack">
      {/* Pane Header with title, subtitle, and filter dropdown */}
      <div className="adm-pane-header">
        <div>
          <h1>Domains</h1>
          <div className="sub">
            {total === 1 ? '1 custom domain' : `${total} custom domains`}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select
            aria-label="Filter domains"
            value={filter}
            onChange={handleFilterChange}
            disabled={isPending}
            style={{ padding: '6px 12px' }}
          >
            <option value="all">All</option>
            <option value="attention">Needs attention</option>
          </select>
        </div>
      </div>

      {feedback && (
        <p className={`msg ${feedback.type === 'ok' ? 'ok' : 'bad'}`} role="status">
          {feedback.message}
        </p>
      )}

      {/* Table */}
      <div className="card tw" style={{ padding: 0 }}>
        {domains.length === 0 ? (
          <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--a-muted)' }}>
            No custom domains found
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Domain</th>
                <th>Tenant</th>
                <th>Status</th>
                <th>Certificate until</th>
                <th>Last check</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {domains.map((d) => (
                <tr key={d.domain}>
                  <td>
                    <code>{d.domain}</code>
                  </td>
                  <td>
                    <Link href={`/platform/tenants/${d.tenant.slug}`}>
                      <b>{d.tenant.name}</b>
                    </Link>
                  </td>
                  <td>{renderStatusBadge(d.status)}</td>
                  <td>{formatCertDate(d.cert_expires_at)}</td>
                  <td>{d.last_checked_at ? relativeTime(d.last_checked_at) : '–'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'inline-flex', gap: '8px', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '3px 10px', fontSize: '13px' }}
                        disabled={recheckingDomain === d.domain}
                        onClick={() => handleRecheck(d.domain)}
                      >
                        {recheckingDomain === d.domain ? 'Checking...' : 'Recheck'}
                      </button>
                      {d.status === 'blocked' ? (
                        <button
                          type="button"
                          className="btn"
                          style={{ padding: '3px 10px', fontSize: '13px' }}
                          disabled={!isAdmin}
                          title={!isAdmin ? 'Platform admin role required' : undefined}
                          onClick={() => openModal(d.domain, 'unblock')}
                        >
                          Unblock
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-danger"
                          style={{ padding: '3px 10px', fontSize: '13px' }}
                          disabled={!isAdmin}
                          title={!isAdmin ? 'Platform admin role required' : undefined}
                          onClick={() => openModal(d.domain, 'block')}
                        >
                          Block
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footnote */}
      <p className="sub" style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--a-muted)' }}>
        Blocking a domain takes the site offline on that address; the tenant address keeps working.
      </p>

      {/* Confirmation Modal for Block / Unblock */}
      {modal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="domain-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            className="card stack"
            style={{
              maxWidth: '480px',
              width: '100%',
              boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
            }}
          >
            <h2 id="domain-modal-title">
              {modal.action === 'block' ? `Block ${modal.domain}` : `Unblock ${modal.domain}`}
            </h2>
            <p className="sub" style={{ margin: 0 }}>
              {modal.action === 'block'
                ? 'Blocking a domain takes the site offline on that address; the tenant address keeps working.'
                : 'Unblocking will verify DNS and restore traffic to this custom domain.'}
            </p>

            {modalError && (
              <p className="msg bad" role="alert">
                {modalError}
              </p>
            )}

            <form onSubmit={handleModalSubmit} className="stack" style={{ gap: '14px' }}>
              <div className="fld" style={{ marginTop: 0 }}>
                <label htmlFor="domain-reason-input">Reason (required for audit log)</label>
                <textarea
                  id="domain-reason-input"
                  required
                  placeholder="Enter reason for this action..."
                  value={modalReason}
                  onChange={(e) => setModalReason(e.target.value)}
                  style={{ minHeight: '80px' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  className="btn"
                  disabled={isSubmitting}
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`btn ${modal.action === 'block' ? 'btn-danger' : 'btn-primary'}`}
                  disabled={isSubmitting || !modalReason.trim()}
                >
                  {isSubmitting
                    ? 'Processing...'
                    : modal.action === 'block'
                    ? 'Confirm block'
                    : 'Confirm unblock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
