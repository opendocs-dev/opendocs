'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { MemberItem, PendingInvitation } from '@/lib/server-api';
import { initials, roleLabel, type Role } from '@/lib/admin-nav';
import { apiErrorMessage } from '@/lib/site-address';

type Props = {
  members: MemberItem[];
  invitations: PendingInvitation[];
  currentUserRole: Role;
};

type RowState = 'normal' | 'confirming_remove';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ROLE_MATRIX: Array<{ action: string; owner: boolean; admin: boolean; editor: boolean }> = [
  { action: 'Guides, categories, analytics', owner: true, admin: true, editor: true },
  { action: 'AI assistant, conversations', owner: true, admin: true, editor: false },
  { action: 'Appearance, domain, SEO, storage', owner: true, admin: true, editor: false },
  { action: 'API keys and MCP', owner: true, admin: true, editor: false },
  { action: 'Members and activity log', owner: true, admin: true, editor: false },
  { action: 'Billing and plan changes', owner: true, admin: false, editor: false },
  { action: 'Delete or transfer the workspace', owner: true, admin: false, editor: false },
];

function formatInvitedExpiry(expiresAt: string): string {
  const then = new Date(expiresAt).getTime();
  if (Number.isNaN(then)) return 'Invited';
  const msLeft = then - Date.now();
  const days = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'Invited, expired';
  if (days === 1) return 'Invited, expires in 1 day';
  return `Invited, expires in ${days} days`;
}

export function formatLastActive(isoString?: string | null): string {
  if (!isoString) return 'Never';
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return 'Never';
  const diffMs = Date.now() - then;
  if (diffMs < 0) return 'Today';
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffHours < 24) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return `${diffDays} days ago`;
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="var(--a-ok, currentColor)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}

export function MembersManager({ members: initialMembers, invitations: initialInvitations, currentUserRole }: Props) {
  const router = useRouter();
  const members = initialMembers;
  const invitations = initialInvitations;
  const canManage = currentUserRole === 'owner' || currentUserRole === 'admin';

  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'editor'>('editor');
  const [inviting, setInviting] = useState(false);

  const flash = (tone: 'ok' | 'bad', text: string) => {
    setStatus({ tone, text });
    setTimeout(() => setStatus(null), 3000);
  };

  const changeRole = async (memberId: string, role: string) => {
    setLoadingId(memberId);
    try {
      const response = await fetch('/api/auth/organization/update-member-role', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ memberId, role }),
      });

      if (response.ok) {
        router.refresh();
      } else {
        const body = await response.json();
        flash('bad', apiErrorMessage(body, 'Could not change role'));
      }
    } catch {
      flash('bad', 'Could not change role');
    } finally {
      setLoadingId(null);
    }
  };

  const removeMember = async (memberId: string) => {
    setLoadingId(memberId);
    try {
      const response = await fetch('/api/auth/organization/remove-member', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ memberIdOrEmail: memberId }),
      });

      if (response.ok) {
        setRowState({ ...rowState, [memberId]: 'normal' });
        router.refresh();
      } else {
        const body = await response.json();
        flash('bad', apiErrorMessage(body, 'Could not remove member'));
      }
    } catch {
      flash('bad', 'Could not remove member');
    } finally {
      setLoadingId(null);
    }
  };

  const resendInvite = async (invitationId: string, email: string, role: string) => {
    setLoadingId(invitationId);
    try {
      const response = await fetch('/api/auth/organization/invite-member', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, role, resend: true }),
      });

      if (response.ok) {
        flash('ok', 'Invite resent');
        router.refresh();
      } else {
        const body = await response.json();
        flash('bad', apiErrorMessage(body, 'Could not resend invite'));
      }
    } catch {
      flash('bad', 'Could not resend invite');
    } finally {
      setLoadingId(null);
    }
  };

  const cancelInvite = async (invitationId: string) => {
    setLoadingId(invitationId);
    try {
      const response = await fetch('/api/auth/organization/cancel-invitation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ invitationId }),
      });

      if (response.ok) {
        router.refresh();
      } else {
        const body = await response.json();
        flash('bad', apiErrorMessage(body, 'Could not cancel invite'));
      }
    } catch {
      flash('bad', 'Could not cancel invite');
    } finally {
      setLoadingId(null);
    }
  };

  const sendInvite = async () => {
    const email = inviteEmail.trim();
    if (!EMAIL_PATTERN.test(email)) {
      flash('bad', 'Enter a valid email address');
      return;
    }

    setInviting(true);
    try {
      const response = await fetch('/api/auth/organization/invite-member', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, role: inviteRole }),
      });

      if (response.ok) {
        setInviteEmail('');
        setInviteRole('editor');
        flash('ok', 'Invite sent');
        router.refresh();
      } else {
        const body = await response.json();
        flash('bad', apiErrorMessage(body, 'Could not send invite'));
      }
    } catch {
      flash('bad', 'Could not send invite');
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="stack">
      {status && <p className={`msg ${status.tone}`}>{status.text}</p>}

      {/* Members & pending invites in one card (Finding 2) */}
      <div className="card tw">
        <h3>Members</h3>
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th>Last active</th>
              {canManage && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="av">{initials(member.name, member.email)}</span>
                    <span>
                      <strong style={{ display: 'block' }}>{member.name || member.email}</strong>
                      {member.name && (
                        <small style={{ display: 'block', color: 'var(--a-muted)' }}>
                          {member.email}
                        </small>
                      )}
                    </span>
                  </div>
                </td>
                <td>
                  {member.role === 'owner' ? (
                    <span className="badge">Owner</span>
                  ) : canManage ? (
                    <select
                      value={member.role}
                      disabled={loadingId === member.id}
                      onChange={(e) => changeRole(member.id, e.target.value)}
                    >
                      <option value="admin">Admin</option>
                      <option value="editor">Editor</option>
                    </select>
                  ) : (
                    <span className="badge">{roleLabel(member.role)}</span>
                  )}
                </td>
                <td>{formatLastActive(member.last_active_at)}</td>
                {canManage && (
                  <td>
                    {member.role === 'owner' ? null : rowState[member.id] === 'confirming_remove' ? (
                      <div className="delete-confirm">
                        <span>Remove {member.name || member.email}?</span>
                        <button
                          type="button"
                          className="btn btn-danger"
                          disabled={loadingId === member.id}
                          onClick={() => removeMember(member.id)}
                        >
                          Remove
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setRowState({ ...rowState, [member.id]: 'normal' })}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => setRowState({ ...rowState, [member.id]: 'confirming_remove' })}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {canManage &&
              invitations.map((invitation) => (
                <tr key={invitation.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="av">?</span>
                      <span>
                        <strong style={{ display: 'block' }}>{invitation.email}</strong>
                        <small style={{ display: 'block', color: 'var(--a-muted)' }}>
                          {formatInvitedExpiry(invitation.expires_at)}
                        </small>
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-warn">{roleLabel(invitation.role)} · pending</span>
                  </td>
                  <td style={{ color: 'var(--a-muted)' }}>—</td>
                  <td className="adm-buttons">
                    <button
                      type="button"
                      className="btn"
                      disabled={loadingId === invitation.id}
                      onClick={() => resendInvite(invitation.id, invitation.email, invitation.role)}
                    >
                      Resend
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={loadingId === invitation.id}
                      onClick={() => cancelInvite(invitation.id)}
                    >
                      Cancel
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Invite by email card (Finding 2, Finding 7, Finding 15) */}
      {canManage && (
        <div id="invite" className="card">
          <h3>Invite by email</h3>
          <div className="grid2">
            <div className="fld">
              <label htmlFor="invite-email">Email</label>
              <input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@company.com"
              />
            </div>
            <div className="fld">
              <label htmlFor="invite-role">Role</label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as 'admin' | 'editor')}
              >
                <option value="editor">Editor</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <div className="adm-buttons" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={sendInvite}
              disabled={inviting || !inviteEmail}
            >
              {inviting ? 'Sending…' : 'Send invite'}
            </button>
          </div>
          <small style={{ color: 'var(--a-muted)', display: 'block', marginTop: 12 }}>
            They sign in with GitHub using the invited email. Invites expire after 7 days.
          </small>
        </div>
      )}

      {/* Role matrix card (Finding 9) */}
      <div className="card tw">
        <h3>What each role can do</h3>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Owner</th>
              <th>Admin</th>
              <th>Editor</th>
            </tr>
          </thead>
          <tbody>
            {ROLE_MATRIX.map((row) => (
              <tr key={row.action}>
                <td>{row.action}</td>
                <td>{row.owner ? <CheckIcon /> : <span style={{ color: 'var(--a-muted)' }}>—</span>}</td>
                <td>{row.admin ? <CheckIcon /> : <span style={{ color: 'var(--a-muted)' }}>—</span>}</td>
                <td>{row.editor ? <CheckIcon /> : <span style={{ color: 'var(--a-muted)' }}>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
