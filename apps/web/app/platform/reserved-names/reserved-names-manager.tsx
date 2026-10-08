'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import type { ReservedName } from '@/lib/server-api';
import { apiErrorMessage } from '@/lib/site-address';

type Props = {
  reservedNames: ReservedName[];
};

type CheckStatus = 'reserved' | 'taken' | 'available' | 'invalid';
type CheckResult = { status: CheckStatus; reason?: string };

function formatReason(reason: string): string {
  const trimmed = reason.trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'phishing' || lower === 'phishing risk') return 'Phishing risk';
  if (lower === 'system') return 'System';
  if (lower === 'trust') return 'Trust';
  if (lower === 'brand') return 'Brand';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function ReservedNamesManager({ reservedNames }: Props) {
  const router = useRouter();

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newReason, setNewReason] = useState('System');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [loadingName, setLoadingName] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const [checkName, setCheckName] = useState('');
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);

  const addReservedName = async () => {
    if (!newName.trim()) return;

    setLoadingName('new');
    try {
      const response = await fetch('/api/v1/platform/reserved-names', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: newName.trim(), reason: newReason.trim() }),
      });

      if (response.ok) {
        setSaveStatus('Saved');
        setTimeout(() => setSaveStatus(null), 2000);
        setNewName('');
        setNewReason('System');
        setShowAddForm(false);
        router.refresh();
      } else {
        const body = await response.json();
        setSaveStatus(`Error: ${apiErrorMessage(body, 'Failed to add')}`);
      }
    } catch {
      setSaveStatus('Error: Failed to add');
    } finally {
      setLoadingName(null);
    }
  };

  const removeReservedName = async (name: string) => {
    setLoadingName(name);
    try {
      const response = await fetch(`/api/v1/platform/reserved-names/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        setRemoving(null);
        router.refresh();
      } else {
        setSaveStatus('Error: Failed to remove');
      }
    } catch {
      setSaveStatus('Error: Could not remove');
    } finally {
      setLoadingName(null);
    }
  };

  const runCheck = async (nameToCheck: string) => {
    const trimmed = nameToCheck.trim();
    if (!trimmed) {
      setCheckResult(null);
      return;
    }

    setChecking(true);
    try {
      const response = await fetch(
        `/api/v1/platform/reserved-names/check?name=${encodeURIComponent(trimmed)}`,
        { credentials: 'include' },
      );

      if (response.ok) {
        setCheckResult((await response.json()) as CheckResult);
      } else {
        setCheckResult({ status: 'invalid', reason: 'Could not check this name' });
      }
    } catch {
      setCheckResult({ status: 'invalid', reason: 'Could not check this name' });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (!checkName.trim()) {
      setCheckResult(null);
      return;
    }
    const timer = setTimeout(() => {
      void runCheck(checkName);
    }, 250);
    return () => clearTimeout(timer);
  }, [checkName]);

  return (
    <div className="stack">
      {/* Pane Header */}
      <div className="adm-pane-header">
        <div>
          <h1>Reserved names</h1>
          <div className="sub">{reservedNames.length} names</div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowAddForm((v) => !v)}
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
          Add name
        </button>
      </div>

      {/* Two-column split layout */}
      <div className="split">
        {/* Left column: Add form & Reserved names table */}
        <div className="stack">
          {showAddForm && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3>Add a reserved name</h3>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowAddForm(false)}
                  style={{ padding: '4px 10px', fontSize: 13 }}
                  aria-label="Close add name form"
                >
                  Cancel
                </button>
              </div>
              <div className="fld">
                <label>Name *</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={30}
                  placeholder="e.g., billing"
                  disabled={loadingName !== null}
                />
              </div>
              <div className="fld">
                <label>Reason *</label>
                <select
                  value={newReason}
                  onChange={(e) => setNewReason(e.target.value)}
                  disabled={loadingName !== null}
                >
                  <option value="System">System</option>
                  <option value="Trust">Trust</option>
                  <option value="Brand">Brand</option>
                  <option value="Phishing risk">Phishing risk</option>
                </select>
              </div>
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  onClick={addReservedName}
                  disabled={loadingName !== null || !newName.trim()}
                  className="btn btn-primary"
                >
                  Add
                </button>
              </div>
            </div>
          )}

          <div className="card">
            <h3>Reserved names</h3>
            {reservedNames.length === 0 ? (
              <p className="muted" style={{ marginTop: 12 }}>
                No reserved names yet.
              </p>
            ) : (
              <div className="tw" style={{ marginTop: 12 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Reason</th>
                      <th style={{ width: 60, textAlign: 'right' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {reservedNames.map((row) => (
                      <tr key={row.name}>
                        <td>
                          <code>{row.name}</code>
                        </td>
                        <td>
                          <span className="badge">{formatReason(row.reason)}</span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {removing === row.name ? (
                            <span className="adm-buttons" style={{ justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                onClick={() => removeReservedName(row.name)}
                                disabled={loadingName !== null}
                                className="btn btn-danger"
                                style={{ height: 30, fontSize: 12, padding: '4px 8px' }}
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                onClick={() => setRemoving(null)}
                                disabled={loadingName !== null}
                                className="btn"
                                style={{ height: 30, fontSize: 12, padding: '4px 8px' }}
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setRemoving(row.name)}
                              disabled={loadingName !== null}
                              className="btn btn-danger"
                              aria-label={`Remove ${row.name}`}
                              style={{
                                width: 44,
                                height: 30,
                                padding: 0,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
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
                                <path d="M4 4l8 8M12 4l-8 8" />
                              </svg>
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right column: Try a name */}
        <div className="stack">
          <div className="card">
            <h3>Try a name</h3>
            <div className="fld">
              <label>Address</label>
              <div className="inl">
                <input
                  type="text"
                  value={checkName}
                  onChange={(e) => setCheckName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void runCheck(checkName);
                    }
                  }}
                  placeholder="e.g., support"
                  disabled={checking}
                />
                <span>.opendocs.xxx</span>
              </div>
              <small>
                Names already used by a tenant are also refused, and tenants are told which.
              </small>
            </div>
            {checkResult && (
              <div role="status" style={{ marginTop: 10 }}>
                {checkResult.status === 'reserved' ? (
                  <p className="msg bad">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ flex: 'none' }}>
                      <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 3.5a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0v-4A.75.75 0 0 1 8 4.5zm0 7.5a.875.875 0 1 1 0-1.75.875.875 0 0 1 0 1.75z" />
                    </svg>
                    <span>&ldquo;{checkName}&rdquo; is reserved ({formatReason(checkResult.reason || '')})</span>
                  </p>
                ) : checkResult.status === 'taken' ? (
                  <p className="msg bad">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ flex: 'none' }}>
                      <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 3.5a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0v-4A.75.75 0 0 1 8 4.5zm0 7.5a.875.875 0 1 1 0-1.75.875.875 0 0 1 0 1.75z" />
                    </svg>
                    <span>&ldquo;{checkName}&rdquo; is already in use by a workspace</span>
                  </p>
                ) : checkResult.status === 'available' ? (
                  <p className="msg ok">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ flex: 'none' }}>
                      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
                    </svg>
                    <span>&ldquo;{checkName}&rdquo; is available</span>
                  </p>
                ) : (
                  <p className="msg bad">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ flex: 'none' }}>
                      <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 3.5a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0v-4A.75.75 0 0 1 8 4.5zm0 7.5a.875.875 0 1 1 0-1.75.875.875 0 0 1 0 1.75z" />
                    </svg>
                    <span>{checkResult.reason || 'Address must be 3-30 characters'}</span>
                  </p>
                )}
              </div>
            )}
          </div>

          {saveStatus && (
            <p role="alert" className={`msg ${saveStatus.startsWith('Error') ? 'bad' : 'ok'}`}>
              {saveStatus}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
