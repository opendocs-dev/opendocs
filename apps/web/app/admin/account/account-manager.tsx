'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AccountInfo } from '@/lib/server-api';
import { initials } from '@/lib/admin-nav';
import { apiErrorMessage } from '@/lib/api-error';

type Props = {
  account: AccountInfo;
};

export function AccountManager({ account }: Props) {
  const router = useRouter();
  const [name, setName] = useState(account.name);
  const [notifyWeeklyDigest, setNotifyWeeklyDigest] = useState(
    account.notify_weekly_digest ?? account.email_notifications ?? true,
  );

  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

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

  const githubHandle = account.github_handle?.replace(/^@/, '');

  return (
    <div className="stack">
      {/* Page Header (UI-A15 Finding 7) */}
      <div className="adm-pane-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1>Account settings</h1>
          <div className="sub" style={{ margin: 0 }}>
            Your profile on this instance
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
        </div>
      </div>
    </div>
  );
}
