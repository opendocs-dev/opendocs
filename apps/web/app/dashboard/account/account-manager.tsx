'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AccountInfo } from '@/lib/server-api';
import { initials, type Role } from '@/lib/admin-nav';
import { apiErrorMessage } from '@/lib/site-address';

type Props = {
  account: AccountInfo;
  currentUserRole: Role;
  organizationId: string | null;
  workspaceName?: string;
};

export function AccountManager({ account, currentUserRole, organizationId, workspaceName = 'workspace' }: Props) {
  const router = useRouter();
  const [name, setName] = useState(account.name);
  const [notifyWeeklyDigest, setNotifyWeeklyDigest] = useState(
    account.notify_weekly_digest ?? account.email_notifications ?? true,
  );
  const [notifyAiCredits, setNotifyAiCredits] = useState(
    account.notify_ai_credits ?? account.email_notifications ?? true,
  );
  const [notifyContentGaps, setNotifyContentGaps] = useState(
    account.notify_content_gaps ?? account.email_notifications ?? true,
  );
  const [notifyInviteAccepted, setNotifyInviteAccepted] = useState(
    account.notify_invite_accepted ?? account.email_notifications ?? true,
  );

  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  const flash = (tone: 'ok' | 'bad', text: string) => {
    setStatus({ tone, text });
    setTimeout(() => setStatus(null), 3000);
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > 80) {
      flash('bad', 'Name must be between 1 and 80 characters');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/v1/account', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: trimmedName,
          notify_weekly_digest: notifyWeeklyDigest,
          notify_ai_credits: notifyAiCredits,
          notify_content_gaps: notifyContentGaps,
          notify_invite_accepted: notifyInviteAccepted,
        }),
      });

      if (response.ok) {
        const body = (await response.json()) as AccountInfo;
        setName(body.name);
        flash('ok', 'Saved');
        router.refresh();
      } else {
        const body = await response.json();
        flash('bad', apiErrorMessage(body, 'Could not save'));
      }
    } catch {
      flash('bad', 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const leaveWorkspace = async () => {
    if (!organizationId) return;

    setLeaving(true);
    try {
      const response = await fetch('/api/auth/organization/leave', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ organizationId }),
      });

      if (response.ok) {
        window.location.href = '/sign-in';
      } else {
        const body = await response.json();
        flash(
          'bad',
          apiErrorMessage(
            body,
            currentUserRole === 'owner'
              ? 'You are the only owner — transfer ownership to someone else first'
              : 'Could not leave the workspace',
          ),
        );
        setConfirmingLeave(false);
      }
    } catch {
      flash('bad', 'Could not leave the workspace');
      setConfirmingLeave(false);
    } finally {
      setLeaving(false);
    }
  };

  const githubHandle = account.github_handle?.replace(/^@/, '');

  return (
    <div className="stack">
      {/* Page Header (UI-A15 Finding 7) */}
      <div className="adm-pane-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1>Account settings</h1>
          <div className="sub" style={{ margin: 0 }}>
            Applies to you in every workspace
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving || !name.trim()}
          onClick={handleSave}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {status && <p className={`msg ${status.tone}`}>{status.text}</p>}

      {/* Profile Card (UI-A15 Finding 3) */}
      <div className="card">
        <h3>Profile</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          {account.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={account.image}
              alt={account.name}
              width={56}
              height={56}
              style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover' }}
            />
          ) : (
            <span className="av" style={{ width: 56, height: 56, fontSize: 20 }}>
              {initials(name, account.email)}
            </span>
          )}
          <div>
            <strong style={{ display: 'block' }}>Photo</strong>
            <small style={{ color: 'var(--a-muted)' }}>Avatar comes from your GitHub account.</small>
          </div>
        </div>

        <div className="fld">
          <label htmlFor="account-name">Name</label>
          <input
            id="account-name"
            type="text"
            value={name}
            maxLength={80}
            disabled={saving}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="fld">
          <label htmlFor="account-email">Email</label>
          <input id="account-email" type="text" value={account.email} readOnly disabled />
          <small style={{ color: 'var(--a-muted)', display: 'block', marginTop: 4 }}>
            Comes from your GitHub account.
          </small>
        </div>
      </div>

      {/* Sign-in Card (UI-A15 Finding 4) */}
      <div className="card">
        <h3>Sign-in</h3>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <strong style={{ display: 'block' }}>GitHub</strong>
            <span style={{ fontSize: 13.5, color: 'var(--a-muted)' }}>
              {githubHandle ? `Connected as @${githubHandle}` : 'Connected via GitHub'}
            </span>
          </div>
          <span className="badge badge-ok">✓ Connected</span>
        </div>
      </div>

      {/* Email Notifications Card (UI-A15 Finding 5 & 10) */}
      <div id="notifications" className="card">
        <h3>Email notifications</h3>
        <div className="stack" style={{ gap: 12 }}>
          <label className="toggle">
            <input
              type="checkbox"
              checked={notifyWeeklyDigest}
              disabled={saving}
              onChange={(e) => setNotifyWeeklyDigest(e.target.checked)}
            />
            <span>Weekly summary of views and searches</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={notifyAiCredits}
              disabled={saving}
              onChange={(e) => setNotifyAiCredits(e.target.checked)}
            />
            <span>AI credits reach 80% and 100%</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={notifyContentGaps}
              disabled={saving}
              onChange={(e) => setNotifyContentGaps(e.target.checked)}
            />
            <span>New content gaps found</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={notifyInviteAccepted}
              disabled={saving}
              onChange={(e) => setNotifyInviteAccepted(e.target.checked)}
            />
            <span>A teammate accepts an invite</span>
          </label>
        </div>
      </div>

      {/* Leave Workspace Card (UI-A15 Finding 6) */}
      <div className="card">
        <h3>Leave this workspace</h3>
        {currentUserRole === 'owner' ? (
          <p className="sub">Owners must transfer ownership first.</p>
        ) : (
          <p className="sub">You will lose access to this workspace&apos;s guides, categories and settings.</p>
        )}
        {confirmingLeave ? (
          <div className="delete-confirm">
            <span>Leave this workspace?</span>
            <button type="button" className="btn btn-danger" disabled={leaving} onClick={leaveWorkspace}>
              {leaving ? 'Leaving…' : 'Leave'}
            </button>
            <button type="button" className="btn" onClick={() => setConfirmingLeave(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="adm-buttons">
            <button type="button" className="btn btn-danger" onClick={() => setConfirmingLeave(true)}>
              Leave {workspaceName}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
