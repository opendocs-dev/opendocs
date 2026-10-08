'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { PlatformAiSettings, PlatformPlanConfig } from '@/lib/server-api';

type Props = {
  initialSettings: PlatformAiSettings | null;
  initialPlans: PlatformPlanConfig[];
  currentRole?: 'admin' | 'support';
};

export function CreditsManager({ initialSettings, initialPlans, currentRole = 'admin' }: Props) {
  const router = useRouter();
  const isAdmin = currentRole === 'admin';

  // Ensure default plans exist in state
  const defaultPlans: PlatformPlanConfig[] = [
    { plan: 'free', monthlyCredits: 0, byokAllowed: false },
    { plan: 'pro', monthlyCredits: 1000, byokAllowed: false },
    { plan: 'enterprise', monthlyCredits: 10000, byokAllowed: true },
  ];

  const mergedPlans = defaultPlans.map((dp) => {
    const found = initialPlans.find((p) => p.plan.toLowerCase() === dp.plan.toLowerCase());
    return found ? { ...dp, ...found } : dp;
  });

  // Settings state
  const [settings, setSettings] = useState<PlatformAiSettings>(
    initialSettings ?? {
      id: 'global',
      aiEnabled: true,
      spendCapMonthly: 500.0,
      currentMonthSpend: 0.0,
      alertPercent: 80,
      pauseAtCap: true,
      creditOverageAction: 'stop',
      chargeOnlyWhenDelivered: true,
      updatedAt: '',
    },
  );

  // Plans state (editable)
  const [plans, setPlans] = useState<PlatformPlanConfig[]>(mergedPlans);

  // When credits run out
  const [overageAction, setOverageAction] = useState<string>(
    settings.creditOverageAction ?? 'stop',
  );
  const [chargeOnlyWhenDelivered, setChargeOnlyWhenDelivered] = useState<boolean>(
    settings.chargeOnlyWhenDelivered ?? true,
  );

  // Platform spend cap
  const [spendCap, setSpendCap] = useState<number>(settings.spendCapMonthly ?? 500);
  const [alertPercent, setAlertPercent] = useState<number>(settings.alertPercent ?? 80);
  const [pauseAtCap, setPauseAtCap] = useState<boolean>(settings.pauseAtCap ?? true);

  // Action states
  const [savingAll, setSavingAll] = useState(false);
  const [togglingKillSwitch, setTogglingKillSwitch] = useState(false);

  // Manual Grant state
  const [tenantTarget, setTenantTarget] = useState('');
  const [grantCredits, setGrantCredits] = useState<number>(100);
  const [grantReason, setGrantReason] = useState('');
  const [granting, setGranting] = useState(false);

  // Feedback status
  const [statusMessage, setStatusMessage] = useState<{ type: 'ok' | 'bad'; text: string } | null>(null);

  const showStatus = (type: 'ok' | 'bad', text: string) => {
    setStatusMessage({ type, text });
    setTimeout(() => setStatusMessage(null), 5000);
  };

  const spendPercent =
    spendCap > 0 ? Math.min(100, Math.round((settings.currentMonthSpend / spendCap) * 100)) : 0;

  const handlePlanCreditsChange = (planName: string, val: number) => {
    setPlans((prev) =>
      prev.map((p) => (p.plan === planName ? { ...p, monthlyCredits: Math.max(0, val) } : p)),
    );
  };

  const handlePlanByokChange = (planName: string, allowed: boolean) => {
    setPlans((prev) =>
      prev.map((p) => (p.plan === planName ? { ...p, byokAllowed: allowed } : p)),
    );
  };

  const handleSaveAll = async () => {
    if (!isAdmin) return;
    setSavingAll(true);
    try {
      // 1. Save global settings
      const settingsRes = await fetch('/api/v1/platform/ai/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          spendCapMonthly: Number(spendCap),
          alertPercent: Number(alertPercent),
          pauseAtCap: Boolean(pauseAtCap),
          creditOverageAction: overageAction,
          chargeOnlyWhenDelivered: Boolean(chargeOnlyWhenDelivered),
        }),
      });

      if (!settingsRes.ok) {
        showStatus('bad', 'Failed to save platform limits settings');
        setSavingAll(false);
        return;
      }
      const updatedSettings = await settingsRes.json();
      setSettings(updatedSettings);

      // 2. Save each plan config (pro & enterprise)
      for (const p of plans) {
        if (p.plan === 'free') continue; // Free plan is fixed at 0
        await fetch(`/api/v1/platform/ai/plans/${p.plan}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            monthlyCredits: Number(p.monthlyCredits),
            byokAllowed: Boolean(p.byokAllowed),
          }),
        });
      }

      showStatus('ok', 'Limits and plan quotas saved successfully.');
      router.refresh();
    } catch {
      showStatus('bad', 'Network error saving limits');
    } finally {
      setSavingAll(false);
    }
  };

  const handleToggleKillSwitch = async () => {
    if (!isAdmin) return;
    setTogglingKillSwitch(true);
    const nextState = !settings.aiEnabled;
    try {
      const res = await fetch('/api/v1/platform/ai/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ aiEnabled: nextState }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSettings(updated);
        showStatus(
          'ok',
          nextState
            ? 'AI services resumed globally.'
            : 'Emergency kill switch activated: AI paused globally.',
        );
        router.refresh();
      } else {
        showStatus('bad', 'Failed to update kill switch state');
      }
    } catch {
      showStatus('bad', 'Network error updating kill switch');
    } finally {
      setTogglingKillSwitch(false);
    }
  };

  const handleManualGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    if (!tenantTarget.trim() || !grantReason.trim() || grantCredits <= 0) {
      showStatus('bad', 'Please provide a valid tenant ID/slug, positive credit amount, and reason.');
      return;
    }

    setGranting(true);
    try {
      const res = await fetch(
        `/api/v1/platform/ai/tenants/${encodeURIComponent(tenantTarget.trim())}/credits`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            credits: Number(grantCredits),
            reason: grantReason.trim(),
          }),
        },
      );

      if (res.ok) {
        const data = await res.json();
        showStatus(
          'ok',
          `Granted ${data.delta} credits to tenant. New balance: ${data.balanceAfter} credits.`,
        );
        setTenantTarget('');
        setGrantReason('');
        setGrantCredits(100);
        router.refresh();
      } else {
        const err = await res.json();
        showStatus('bad', err.error?.message || 'Failed to grant credits');
      }
    } catch {
      showStatus('bad', 'Network error granting credits');
    } finally {
      setGranting(false);
    }
  };

  return (
    <div className="stack" style={{ gap: '24px' }}>
      {/* Pane Header */}
      <div className="adm-pane-header">
        <div>
          <h1>Credits and limits</h1>
          <div className="sub">1 credit = 1 reply to a reader</div>
        </div>
        {isAdmin && (
          <div className="adm-buttons">
            <button
              type="button"
              className="btn btn-primary"
              disabled={savingAll}
              onClick={handleSaveAll}
            >
              {savingAll ? 'Saving...' : 'Save limits'}
            </button>
          </div>
        )}
      </div>

      {!isAdmin && (
        <div role="status" className="card" style={{ padding: '12px 16px', background: 'var(--a-soft)' }}>
          <b>Read-only access:</b> Platform admin role is required to modify credits and platform limits.
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

      {/* Card 1: Monthly credits by plan */}
      <section className="card" style={{ padding: '20px' }}>
        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 4px 0' }}>Monthly credits by plan</h3>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--a-line)' }}>
                <th style={{ padding: '10px 12px' }}>Plan</th>
                <th style={{ padding: '10px 12px' }}>Credits a month</th>
                <th style={{ padding: '10px 12px' }}>Own provider key (BYOK)</th>
                <th style={{ padding: '10px 12px' }}>Models</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => {
                const isFree = p.plan === 'free';
                const isPro = p.plan === 'pro';
                const isEnterprise = p.plan === 'enterprise';

                return (
                  <tr key={p.plan} style={{ borderBottom: '1px solid var(--a-line)' }}>
                    <td style={{ padding: '12px', fontWeight: 600, textTransform: 'capitalize' }}>
                      {p.plan}
                    </td>

                    {/* Credits a month */}
                    <td style={{ padding: '12px' }}>
                      {isFree ? (
                        <span style={{ color: 'var(--a-muted)' }}>0</span>
                      ) : (
                        <input
                          type="number"
                          min="0"
                          step="100"
                          disabled={!isAdmin}
                          value={p.monthlyCredits}
                          onChange={(e) => handlePlanCreditsChange(p.plan, Number(e.target.value))}
                          style={{
                            width: '120px',
                            padding: '6px 10px',
                            borderRadius: '6px',
                            border: '1px solid var(--a-line)',
                          }}
                        />
                      )}
                    </td>

                    {/* Own provider key (BYOK) */}
                    <td style={{ padding: '12px' }}>
                      {isFree ? (
                        <span style={{ color: 'var(--a-muted)' }}>Not allowed</span>
                      ) : (
                        <label
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            cursor: isAdmin ? 'pointer' : 'default',
                          }}
                        >
                          <input
                            type="checkbox"
                            disabled={!isAdmin}
                            checked={p.byokAllowed}
                            onChange={(e) => handlePlanByokChange(p.plan, e.target.checked)}
                          />
                          <span>Allowed</span>
                        </label>
                      )}
                    </td>

                    {/* Models */}
                    <td style={{ padding: '12px', color: 'var(--a-muted)', fontSize: '13px' }}>
                      {isFree && 'AI assistant is off'}
                      {isPro && 'Catalog models marked Pro'}
                      {isEnterprise && 'Catalog models marked Enterprise'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="sub" style={{ marginTop: '16px', fontSize: '13px' }}>
          Numbers are examples. Credits reset on the 1st of each month. A reply through a tenant's own key costs 0 credits.
        </p>
      </section>

      {/* Card 2: When credits run out */}
      <section className="card" style={{ padding: '20px' }}>
        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 4px 0' }}>When credits run out</h3>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Radio Option 1: Stop AI replies */}
          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              cursor: isAdmin ? 'pointer' : 'default',
            }}
          >
            <input
              type="radio"
              name="credit-overage"
              value="stop"
              disabled={!isAdmin}
              checked={overageAction === 'stop'}
              onChange={() => setOverageAction('stop')}
              style={{ marginTop: '3px' }}
            />
            <div>
              <div style={{ fontWeight: 600 }}>Stop AI replies</div>
              <div className="sub" style={{ fontSize: '13px' }}>
                Readers see the contact options. The owner is emailed at 80% and 100%.
              </div>
            </div>
          </label>

          {/* Radio Option 2: Let the owner add credits */}
          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              cursor: isAdmin ? 'pointer' : 'default',
            }}
          >
            <input
              type="radio"
              name="credit-overage"
              value="add_credits"
              disabled={!isAdmin}
              checked={overageAction === 'add_credits'}
              onChange={() => setOverageAction('add_credits')}
              style={{ marginTop: '3px' }}
            />
            <div>
              <div style={{ fontWeight: 600 }}>Let the owner add credits</div>
              <div className="sub" style={{ fontSize: '13px' }}>
                An &quot;Add credits&quot; button appears in their admin.
              </div>
            </div>
          </label>

          <hr style={{ border: 'none', borderTop: '1px solid var(--a-line)', margin: '4px 0' }} />

          {/* Toggle: Charge only when a reply is delivered */}
          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              cursor: isAdmin ? 'pointer' : 'default',
            }}
          >
            <input
              type="checkbox"
              disabled={!isAdmin}
              checked={chargeOnlyWhenDelivered}
              onChange={(e) => setChargeOnlyWhenDelivered(e.target.checked)}
              style={{ marginTop: '3px' }}
            />
            <div>
              <div style={{ fontWeight: 600 }}>Charge only when a reply is delivered</div>
              <div className="sub" style={{ fontSize: '13px' }}>
                A failed model call costs nothing.
              </div>
            </div>
          </label>
        </div>
      </section>

      {/* Card 3: Platform spend cap */}
      <section className="card" style={{ padding: '20px' }}>
        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 4px 0' }}>Platform spend cap</h3>
          <p className="sub" style={{ margin: 0 }}>
            What all tenants together may cost us in provider fees this month.
          </p>
        </div>

        {/* Visual meter */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
            <span style={{ fontWeight: 600 }}>{spendPercent}% of the cap used</span>
            <span style={{ color: 'var(--a-muted)' }}>
              ${settings.currentMonthSpend.toFixed(2)} / ${spendCap}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={spendPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            style={{
              width: '100%',
              height: '8px',
              background: 'var(--a-line)',
              borderRadius: '4px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${spendPercent}%`,
                height: '100%',
                background:
                  spendPercent >= 90
                    ? 'var(--a-bad)'
                    : spendPercent >= 70
                    ? 'var(--a-warn)'
                    : 'var(--a-brand)',
                borderRadius: '4px',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              Monthly cap ($)
            </label>
            <input
              type="number"
              min="0"
              step="50"
              disabled={!isAdmin}
              value={spendCap}
              onChange={(e) => setSpendCap(Number(e.target.value))}
              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--a-line)' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
              Alert at
            </label>
            <div style={{ display: 'flex', gap: '12px', marginTop: '6px' }}>
              {[70, 80, 90].map((pct) => (
                <label
                  key={pct}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '13px',
                    cursor: isAdmin ? 'pointer' : 'default',
                  }}
                >
                  <input
                    type="radio"
                    name="alert-percent"
                    value={pct}
                    disabled={!isAdmin}
                    checked={alertPercent === pct}
                    onChange={() => setAlertPercent(pct)}
                  />
                  <span>{pct}%</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div style={{ marginTop: '16px' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              cursor: isAdmin ? 'pointer' : 'default',
            }}
          >
            <input
              type="checkbox"
              disabled={!isAdmin}
              checked={pauseAtCap}
              onChange={(e) => setPauseAtCap(e.target.checked)}
              style={{ marginTop: '3px' }}
            />
            <div>
              <div style={{ fontWeight: 600 }}>Pause AI for everyone when the cap is reached</div>
              <div className="sub" style={{ fontSize: '13px' }}>
                Readers see the contact options; guides and search keep working.
              </div>
            </div>
          </label>
        </div>
      </section>

      {/* Card 4: Global Emergency Kill Switch */}
      <section className="card" style={{ padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h3 style={{ margin: '0 0 4px 0' }}>Emergency kill switch</h3>
            <p className="sub" style={{ margin: 0 }}>
              Instantly pause or resume AI assistant across all workspaces globally.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span className={`badge ${settings.aiEnabled ? 'badge-ok' : 'badge-bad'}`}>
              {settings.aiEnabled ? 'AI Active' : 'AI Paused'}
            </span>
            {isAdmin && (
              <button
                type="button"
                className={`btn ${settings.aiEnabled ? 'btn-danger' : 'btn-primary'}`}
                disabled={togglingKillSwitch}
                onClick={handleToggleKillSwitch}
              >
                {togglingKillSwitch
                  ? 'Updating...'
                  : settings.aiEnabled
                  ? 'Pause AI globally'
                  : 'Resume AI globally'}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Card 5: Manual tenant credit grant */}
      {isAdmin && (
        <section className="card" style={{ padding: '20px' }}>
          <div style={{ marginBottom: '16px' }}>
            <h3 style={{ margin: '0 0 4px 0' }}>Manual tenant credit grant</h3>
            <p className="sub" style={{ margin: 0 }}>
              Grant additional AI credits directly to a workspace with an audited reason.
            </p>
          </div>

          <form onSubmit={handleManualGrant} style={{ maxWidth: '600px', display: 'grid', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                Tenant Workspace ID or Slug
              </label>
              <input
                type="text"
                placeholder="e.g. acme-docs or workspace UUID"
                value={tenantTarget}
                onChange={(e) => setTenantTarget(e.target.value)}
                required
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--a-line)' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                Credits to grant
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={grantCredits}
                onChange={(e) => setGrantCredits(Number(e.target.value))}
                required
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--a-line)' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                Reason for grant (Recorded in audit ledger)
              </label>
              <input
                type="text"
                placeholder="e.g. Support goodwill / promotional credit"
                value={grantReason}
                onChange={(e) => setGrantReason(e.target.value)}
                required
                style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--a-line)' }}
              />
            </div>

            <div style={{ marginTop: '8px' }}>
              <button type="submit" className="btn btn-primary" disabled={granting}>
                {granting ? 'Granting...' : 'Grant credits'}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
