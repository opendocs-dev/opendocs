'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { PlatformAuditLogEntry, PlatformStaffMember } from '@/lib/server-api';
import { initials } from '@/lib/admin-nav';
import { formatAuditTime, formatLastActive } from '@/lib/audit-time';

type Props = {
  initialStaff: PlatformStaffMember[];
  initialAuditLogs: PlatformAuditLogEntry[];
  currentRole: 'admin' | 'support';
  currentUserId: string;
};

export function StaffManager({
  initialStaff,
  initialAuditLogs,
  currentRole,
  currentUserId,
}: Props) {
  const router = useRouter();

  const [staffList, setStaffList] = useState(initialStaff);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'support'>('support');
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);

  const canManage = currentRole === 'admin';

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setIsAdding(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch('/api/v1/platform/staff', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message || 'Failed to add staff member');
        return;
      }

      setStaffList((prev) => [...prev, data.staff]);
      setEmail('');
      setShowAddDialog(false);
      setSuccess(`Added ${data.staff.email} as ${data.staff.role === 'admin' ? 'Admin' : 'Support'}`);
      router.refresh();
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setIsAdding(false);
    }
  };

  const handleRoleChange = async (memberId: string, newRole: 'admin' | 'support') => {
    setError(null);
    try {
      const res = await fetch(`/api/v1/platform/staff/${memberId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message || 'Failed to update role');
        return;
      }

      setStaffList((prev) =>
        prev.map((s) => (s.id === memberId ? { ...s, role: newRole } : s)),
      );
      router.refresh();
    } catch {
      setError('An unexpected error occurred');
    }
  };

  const handleRemoveStaff = async (memberId: string) => {
    setConfirmingRemoveId(null);
    setError(null);
    try {
      const res = await fetch(`/api/v1/platform/staff/${memberId}`, {
        method: 'DELETE',
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message || 'Failed to remove staff member');
        return;
      }

      setStaffList((prev) => prev.filter((s) => s.id !== memberId));
      router.refresh();
    } catch {
      setError('An unexpected error occurred');
    }
  };

  return (
    <div className="stack">
      <div className="adm-pane-header">
        <div>
          <h1>Staff and audit log</h1>
          <div>{staffList.length} staff</div>
        </div>
        {canManage && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowAddDialog(true)}
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
            Add staff
          </button>
        )}
      </div>

      {error && <p className="msg bad" role="alert">{error}</p>}
      {success && <p className="msg ok" role="status">{success}</p>}

      {showAddDialog && canManage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-staff-dialog-title"
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
              boxShadow: '0 8px 30px rgba(0, 0, 0, 0.12)',
            }}
          >
            <h2 id="add-staff-dialog-title">Add platform staff</h2>
            <p className="sub" style={{ margin: 0 }}>
              The person must have signed in to OpenDocs at least once before they can be added.
            </p>
            {error && <p className="msg bad" role="alert">{error}</p>}
            <form onSubmit={handleAddStaff} className="stack" style={{ gap: '14px' }}>
              <div className="fld" style={{ marginTop: 0 }}>
                <label htmlFor="staff-email">Email</label>
                <input
                  id="staff-email"
                  type="email"
                  required
                  placeholder="staff@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="fld" style={{ marginTop: 0 }}>
                <label htmlFor="staff-role">Role</label>
                <select
                  id="staff-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'admin' | 'support')}
                >
                  <option value="support">Support</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  className="btn"
                  disabled={isAdding}
                  onClick={() => setShowAddDialog(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isAdding}
                >
                  {isAdding ? 'Adding...' : 'Add staff member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card tw" style={{ padding: '4px 8px' }}>
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th>Two-step sign-in</th>
              <th>Last active</th>
              {canManage && <th><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {staffList.map((member) => (
              <tr key={member.id}>
                <td>
                  <span className="pp">
                    <span className="av">{initials(member.name, member.email)}</span>
                    <span>
                      <b>{member.name || member.email}</b>
                      {member.name && <small style={{ display: 'block', color: 'var(--a-muted)' }}>{member.email}</small>}
                    </span>
                  </span>
                </td>
                <td>
                  {canManage ? (
                    <select
                      aria-label={`Role of ${member.name || member.email}`}
                      value={member.role}
                      onChange={(e) => handleRoleChange(member.id, e.target.value as 'admin' | 'support')}
                      style={{ width: 'auto' }}
                    >
                      <option value="admin">Admin</option>
                      <option value="support">Support</option>
                    </select>
                  ) : (
                    <span>{member.role === 'admin' ? 'Admin' : 'Support'}</span>
                  )}
                </td>
                <td>
                  <span className={`badge ${member.two_factor_enabled ? 'badge-ok' : 'badge-bad'}`}>
                    {member.two_factor_enabled ? 'On' : 'Off'}
                  </span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }} title={member.last_active_at ? new Date(member.last_active_at).toISOString() : undefined}>
                  {formatLastActive(member.last_active_at)}
                </td>
                {canManage && (
                  <td>
                    {confirmingRemoveId === member.id ? (
                      <div className="delete-confirm">
                        <span>Remove {member.name || member.email}?</span>
                        <button
                          type="button"
                          className="btn btn-danger"
                          onClick={() => handleRemoveStaff(member.id)}
                        >
                          Remove
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setConfirmingRemoveId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => setConfirmingRemoveId(member.id)}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card tw">
        <h3>Audit log</h3>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Tenant</th>
            </tr>
          </thead>
          <tbody>
            {initialAuditLogs.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', color: 'var(--a-muted)', padding: '24px' }}>
                  No audit log entries recorded yet.
                </td>
              </tr>
            ) : (
              initialAuditLogs.map((log) => (
                <tr key={log.id}>
                  <td style={{ whiteSpace: 'nowrap' }} title={new Date(log.created_at).toISOString()}>
                    {formatAuditTime(log.created_at)}
                  </td>
                  <td>{log.actor_name || log.actor_email || 'Staff'}</td>
                  <td>{log.action}</td>
                  <td>{log.tenant_name || '–'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
