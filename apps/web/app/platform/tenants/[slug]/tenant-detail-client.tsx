'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { PlatformTenantDetail } from '@/lib/server-api';
import { formatTenantDate } from '@/lib/tenant-format';
import { relativeTime } from '@/lib/relative-time';

type Props = {
  initialTenant: PlatformTenantDetail;
  currentRole: 'admin' | 'support';
};

export function TenantDetailClient({ initialTenant, currentRole }: Props) {
  const router = useRouter();
  const isAdmin = currentRole === 'admin';

  const [tenant, setTenant] = useState<PlatformTenantDetail>(initialTenant);

  // Plan state
  const [selectedPlan, setSelectedPlan] = useState(tenant.plan);
  const [planReason, setPlanReason] = useState('');
  const [isUpdatingPlan, setIsUpdatingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planSuccess, setPlanSuccess] = useState<string | null>(null);

  // Credits state
  const [grantCredits, setGrantCredits] = useState('');
  const [creditsReason, setCreditsReason] = useState('');
  const [isGrantingCredits, setIsGrantingCredits] = useState(false);
  const [creditsError, setCreditsError] = useState<string | null>(null);
  const [creditsSuccess, setCreditsSuccess] = useState<string | null>(null);

  // Suspend / restore dialog state
  const [showSuspendModal, setShowSuspendModal] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [isSuspending, setIsSuspending] = useState(false);
  const [suspendError, setSuspendError] = useState<string | null>(null);

  const isSuspended = tenant.status === 'suspended';

  // Handler: Change plan
  const handleChangePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;

    if (!planReason.trim()) {
      setPlanError('A reason is required to change plan');
      return;
    }

    setIsUpdatingPlan(true);
    setPlanError(null);
    setPlanSuccess(null);

    try {
      const res = await fetch(`/api/v1/platform/tenants/${tenant.slug}/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan: selectedPlan, reason: planReason.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setPlanError(data.error?.message || 'Failed to update plan');
        return;
      }

      setTenant((prev) => ({ ...prev, plan: selectedPlan }));
      setPlanSuccess(`Plan successfully changed to ${selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1)}`);
      setPlanReason('');
      router.refresh();
    } catch {
      setPlanError('An unexpected error occurred');
    } finally {
      setIsUpdatingPlan(false);
    }
  };

  // Handler: Grant AI credits
  const handleGrantCredits = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;

    const numCredits = parseInt(grantCredits, 10);
    if (isNaN(numCredits) || numCredits <= 0) {
      setCreditsError('Credits must be a positive number');
      return;
    }

    if (!creditsReason.trim()) {
      setCreditsError('A reason is required to grant credits');
      return;
    }

    setIsGrantingCredits(true);
    setCreditsError(null);
    setCreditsSuccess(null);

    try {
      const res = await fetch(`/api/v1/platform/tenants/${tenant.slug}/credits`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credits: numCredits, reason: creditsReason.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setCreditsError(data.error?.message || 'Failed to grant credits');
        return;
      }

      setTenant((prev) => ({
        ...prev,
        ai_credits: {
          ...prev.ai_credits,
          balance: data.balance,
        },
      }));
      setCreditsSuccess(`Successfully granted ${numCredits.toLocaleString()} credits`);
      setGrantCredits('');
      setCreditsReason('');
      router.refresh();
    } catch {
      setCreditsError('An unexpected error occurred');
    } finally {
      setIsGrantingCredits(false);
    }
  };

  // Handler: Suspend / Restore
  const handleSuspendToggle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;

    if (!suspendReason.trim()) {
      setSuspendError('A reason is required');
      return;
    }

    const action = isSuspended ? 'restore' : 'suspend';
    setIsSuspending(true);
    setSuspendError(null);

    try {
      const res = await fetch(`/api/v1/platform/tenants/${tenant.slug}/suspend`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, reason: suspendReason.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setSuspendError(data.error?.message || `Failed to ${action} site`);
        return;
      }

      setTenant((prev) => ({
        ...prev,
        status: data.status,
        suspended_at: action === 'suspend' ? new Date().toISOString() : null,
      }));
      setShowSuspendModal(false);
      setSuspendReason('');
      router.refresh();
    } catch {
      setSuspendError('An unexpected error occurred');
    } finally {
      setIsSuspending(false);
    }
  };

  // Credit calculation
  const monthlyLimit = tenant.ai_credits.monthly_limit || 10000;
  const usedThisMonth = tenant.ai_credits.used_this_month || 0;
  const creditPercent = monthlyLimit > 0 ? Math.min(100, Math.round((usedThisMonth / monthlyLimit) * 100)) : 0;

  return (
    <div className="stack">
      {/* Breadcrumb */}
      <div>
        <Link href="/platform/tenants" style={{ textDecoration: 'none', color: 'var(--a-muted)', fontSize: '13.5px' }}>
          ← Tenants
        </Link>
      </div>

      {/* Header */}
      <div className="adm-pane-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1>{tenant.name}</h1>
            <span className={`badge ${isSuspended ? 'badge-bad' : 'badge-ok'}`}>
              {isSuspended ? 'Suspended' : 'Active'}
            </span>
          </div>
          <div className="sub">
            <code>{tenant.address}</code> · created {formatTenantDate(tenant.created_at)}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {!isAdmin && (
            <span className="sub" style={{ fontSize: '12px' }}>
              Platform admin role required to suspend/restore
            </span>
          )}
          <button
            type="button"
            className={`btn ${isSuspended ? 'btn-primary' : 'btn-danger'}`}
            disabled={!isAdmin}
            onClick={() => {
              setSuspendError(null);
              setSuspendReason('');
              setShowSuspendModal(true);
            }}
          >
            {isSuspended ? 'Restore site' : 'Suspend site'}
          </button>
        </div>
      </div>

      {/* Tabs navigation (Overview is active; Domains, Guides, Audit log hidden until built) */}
      <div className="seg" role="tablist">
        <button type="button" aria-current="page" role="tab" aria-selected="true">
          Overview
        </button>
      </div>

      {/* Cards Grid */}
      <div className="grid2">
        {/* Card 1: Plan */}
        <div className="card stack">
          <h3>Plan</h3>
          <p className="sub" style={{ margin: 0 }}>
            Change the workspace plan. Requires an audit reason.
          </p>

          {planError && <p className="msg bad" role="alert">{planError}</p>}
          {planSuccess && <p className="msg ok" role="status">{planSuccess}</p>}

          {!isAdmin && (
            <p className="sub" style={{ color: 'var(--a-warn)', margin: 0 }}>
              Platform admin role required to change plan.
            </p>
          )}

          <form onSubmit={handleChangePlan} className="stack" style={{ gap: '12px' }}>
            <div className="fld" style={{ marginTop: 0 }}>
              <label htmlFor="plan-select">Plan</label>
              <select
                id="plan-select"
                value={selectedPlan}
                disabled={!isAdmin || isUpdatingPlan}
                onChange={(e) => setSelectedPlan(e.target.value)}
              >
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>

            <div className="fld" style={{ marginTop: 0 }}>
              <label htmlFor="plan-reason">Reason (kept in the audit log)</label>
              <input
                id="plan-reason"
                type="text"
                placeholder="e.g. Approved custom contract terms"
                value={planReason}
                disabled={!isAdmin || isUpdatingPlan}
                onChange={(e) => setPlanReason(e.target.value)}
                required
              />
            </div>

            <div>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!isAdmin || isUpdatingPlan || selectedPlan === tenant.plan}
              >
                {isUpdatingPlan ? 'Updating...' : 'Change plan'}
              </button>
            </div>
          </form>
        </div>

        {/* Card 2: AI credits */}
        <div className="card stack">
          <h3>AI credits</h3>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
              <span>
                <b>{usedThisMonth.toLocaleString()}</b> of {monthlyLimit.toLocaleString()} used this month
              </span>
              <span>{tenant.ai_credits.balance.toLocaleString()} credits balance</span>
            </div>
            <div className="bar">
              <div className="bar-fill" style={{ width: `${creditPercent}%` }} />
            </div>
            <div className="sub" style={{ fontSize: '12.5px' }}>
              model {tenant.ai_credits.model} · {tenant.ai_credits.byo_set ? 'own key set' : 'own key not set'}
            </div>
          </div>

          {creditsError && <p className="msg bad" role="alert">{creditsError}</p>}
          {creditsSuccess && <p className="msg ok" role="status">{creditsSuccess}</p>}

          {!isAdmin && (
            <p className="sub" style={{ color: 'var(--a-warn)', margin: 0 }}>
              Platform admin role required to grant credits.
            </p>
          )}

          <form onSubmit={handleGrantCredits} className="stack" style={{ gap: '12px' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <div className="fld" style={{ marginTop: 0, flex: 1 }}>
                <label htmlFor="grant-credits">Grant credits</label>
                <input
                  id="grant-credits"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="e.g. 5000"
                  value={grantCredits}
                  disabled={!isAdmin || isGrantingCredits}
                  onChange={(e) => setGrantCredits(e.target.value)}
                  required
                />
              </div>
              <div className="fld" style={{ marginTop: 0, flex: 2 }}>
                <label htmlFor="credits-reason">Reason</label>
                <input
                  id="credits-reason"
                  type="text"
                  placeholder="e.g. Annual contract allowance"
                  value={creditsReason}
                  disabled={!isAdmin || isGrantingCredits}
                  onChange={(e) => setCreditsReason(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                className="btn"
                disabled={!isAdmin || isGrantingCredits || !grantCredits}
              >
                {isGrantingCredits ? 'Granting...' : 'Grant credits'}
              </button>
            </div>
          </form>
        </div>

        {/* Card 3: Domain */}
        <div className="card stack">
          <h3>Domain</h3>
          <ul className="check">
            <li className="done">
              <div className="tick">✓</div>
              <span>
                <code>{tenant.domain.primary}</code> live
              </span>
            </li>
            {tenant.domain.custom_domain ? (
              <li className={tenant.domain.domain_status === 'verified' ? 'done' : ''}>
                <div className="tick">{tenant.domain.domain_status === 'verified' ? '✓' : '•'}</div>
                <span>
                  <code>{tenant.domain.custom_domain}</code>{' '}
                  {tenant.domain.domain_status === 'verified' ? 'verified' : tenant.domain.domain_status}
                  {tenant.domain.cert_expires_at &&
                    `, certificate valid until ${formatTenantDate(tenant.domain.cert_expires_at)}`}
                </span>
              </li>
            ) : (
              <li style={{ color: 'var(--a-muted)', fontSize: '13px' }}>
                <div className="tick">•</div>
                <span>No custom domain configured</span>
              </li>
            )}
          </ul>
        </div>

        {/* Card 4: Audit log */}
        <div className="card stack">
          <h3>Audit log</h3>
          {tenant.audit_logs.length === 0 ? (
            <p className="sub" style={{ margin: 0 }}>
              No audit log entries for this tenant.
            </p>
          ) : (
            <div style={{ display: 'grid', gap: '10px' }}>
              {tenant.audit_logs.slice(0, 5).map((log) => {
                const detailReason =
                  typeof log.detail === 'object' && log.detail !== null && 'reason' in log.detail
                    ? String((log.detail as { reason?: unknown }).reason)
                    : null;

                return (
                  <div
                    key={log.id}
                    style={{
                      borderBottom: '1px solid var(--a-line)',
                      paddingBottom: '8px',
                      fontSize: '13px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--a-muted)' }}>
                      <span>{log.actor_name || 'Staff'}</span>
                      <span>{relativeTime(log.created_at)}</span>
                    </div>
                    <div style={{ fontWeight: 500, marginTop: '2px' }}>{log.action}</div>
                    {detailReason && (
                      <div className="sub" style={{ fontSize: '12px', marginTop: '2px' }}>
                        Reason: {detailReason}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal for Suspend / Restore */}
      {showSuspendModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="suspend-dialog-title"
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
            <h2 id="suspend-dialog-title">{isSuspended ? 'Restore site' : 'Suspend site'}</h2>
            <p className="sub" style={{ margin: 0 }}>
              {isSuspended
                ? 'Restoring the site will make its public guides accessible to readers again.'
                : 'Suspending this workspace will immediately make its public site return 404 Not Found to visitors.'}
            </p>

            {suspendError && <p className="msg bad" role="alert">{suspendError}</p>}

            <form onSubmit={handleSuspendToggle} className="stack" style={{ gap: '14px' }}>
              <div className="fld" style={{ marginTop: 0 }}>
                <label htmlFor="suspend-reason-input">Reason (required for audit log)</label>
                <textarea
                  id="suspend-reason-input"
                  required
                  placeholder="Enter reason for this action..."
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  style={{ minHeight: '80px' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  className="btn"
                  disabled={isSuspending}
                  onClick={() => setShowSuspendModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`btn ${isSuspended ? 'btn-primary' : 'btn-danger'}`}
                  disabled={isSuspending || !suspendReason.trim()}
                >
                  {isSuspending
                    ? 'Processing...'
                    : isSuspended
                    ? 'Confirm restore'
                    : 'Confirm suspension'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
