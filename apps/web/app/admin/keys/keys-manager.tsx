'use client';

import { useCallback, useEffect, useState } from 'react';

import { formatKeyLastUsed, maskKey } from '@/lib/key-mask';

import { ConnectToolCard } from './connect-tool-card';
import { NewKeyPanel } from './new-key-panel';

export type ApiKey = {
  id: string;
  name: string | null;
  start: string | null;
  createdAt: string;
  lastRequest: string | null;
  enabled: boolean;
};

export function KeysManager({
  organizationId,
  initialKeys,
  initialShowCreate = false,
}: {
  organizationId: string;
  initialKeys?: ApiKey[];
  initialShowCreate?: boolean;
}) {
  const [keys, setKeys] = useState<ApiKey[]>(initialKeys ?? []);
  const [loading, setLoading] = useState(initialKeys === undefined);
  const [showCreate, setShowCreate] = useState(initialShowCreate);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // Returns false on failure so callers can keep their own, more specific error.
  const loadKeys = useCallback(async (): Promise<boolean> => {
    setLoading(true);

    try {
      const response = await fetch(
        `/api/auth/api-key/list?organizationId=${encodeURIComponent(organizationId)}`,
        { credentials: 'include', cache: 'no-store' },
      );

      if (!response.ok) throw new Error('list failed');

      const body = (await response.json()) as { apiKeys?: ApiKey[] };

      setKeys(body.apiKeys ?? []);
      return true;
    } catch {
      return false;
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void loadKeys().then((ok) => {
      if (!ok) setError('Could not load your API keys.');
    });
  }, [loadKeys]);

  async function createKey() {
    setCreating(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/auth/api-key/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          organizationId,
          name: name.trim() || undefined,
          termsAccepted,
        }),
      });

      const body = (await response.json()) as { key?: string; message?: string };

      if (!response.ok || !body.key) {
        setError(body.message ?? 'Could not create the key.');

        return;
      }

      setCreatedKey(body.key);
      setName('');
      setTermsAccepted(false);
      setShowCreate(false);
      if (!(await loadKeys())) setError('Could not load your API keys.');
    } catch {
      setError('Could not create the key.');
    } finally {
      setCreating(false);
    }
  }

  async function revokeKey(keyId: string) {
    if (revoking) return;
    setConfirmingId(null);

    setRevoking(keyId);
    setError(null);
    setNotice(null);
    let failed = false;

    try {
      const response = await fetch('/api/auth/api-key/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ keyId }),
      });

      if (response.status === 404) setNotice('Already revoked');
      else if (!response.ok) failed = true;
    } catch {
      failed = true;
    } finally {
      const listed = await loadKeys();
      if (failed) setError('Could not revoke the key.');
      else if (!listed) setError('Could not load your API keys.');
      setRevoking(null);
    }
  }

  return (
    <div className="stack">
      <div className="adm-pane-header">
        <div>
          <h1>API keys and MCP</h1>
          <div>Let your AI agent record guides</div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowCreate((v) => !v)}
        >
          + New key
        </button>
      </div>

      <div className="split">
        <div className="stack">
          {createdKey ? (
            <NewKeyPanel keyValue={createdKey} onClose={() => setCreatedKey(null)} />
          ) : null}

          {showCreate ? (
            <section className="card" aria-label="Create an API key">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3>Create an API key</h3>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowCreate(false)}
                  aria-label="Close create key form"
                >
                  Cancel
                </button>
              </div>
              <div className="fld">
                <label htmlFor="key-name">Name (optional)</label>
                <input
                  id="key-name"
                  type="text"
                  value={name}
                  placeholder="Laptop, CI, ..."
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="fld">
                <label
                  htmlFor="terms"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
                >
                  <input
                    id="terms"
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(event) => setTermsAccepted(event.target.checked)}
                  />
                  <span>
                    This key is for staging/demo data only. I agree to the Terms.
                  </span>
                </label>
              </div>
              <div style={{ marginTop: '12px' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={createKey}
                  disabled={!termsAccepted || creating}
                >
                  Create key
                </button>
              </div>
              {termsAccepted ? null : (
                <p className="sub" style={{ marginTop: '6px' }}>
                  Accept the terms above to create a key.
                </p>
              )}
              {error ? <p role="alert" className="msg bad">{error}</p> : null}
              {notice ? <p role="status" className="msg ok">{notice}</p> : null}
            </section>
          ) : null}

      <section className="card">
        <h3>Keys</h3>
        {loading ? <p className="sub">Loading…</p> : null}
        {!loading && keys.length === 0 ? (
          <p className="sub">No keys yet. Create one above to connect your agent.</p>
        ) : null}
        {keys.length > 0 ? (
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Key</th>
                  <th>Last used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keys.map((apiKey) => (
                  <tr key={apiKey.id}>
                    <td>
                      <strong>{apiKey.name ?? '—'}</strong>
                    </td>
                    <td>
                      <code>{maskKey(apiKey.start)}</code>
                    </td>
                    <td>{formatKeyLastUsed(apiKey.lastRequest)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {confirmingId === apiKey.id ? (
                        <span style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                          <span className="sub">Revoke this key?</span>
                          <button
                            type="button"
                            className="btn btn-danger"
                            disabled={revoking !== null}
                            onClick={() => revokeKey(apiKey.id)}
                          >
                            {revoking === apiKey.id ? 'Revoking…' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            className="btn"
                            disabled={revoking !== null}
                            onClick={() => setConfirmingId(null)}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-danger"
                          disabled={revoking !== null}
                          onClick={() => setConfirmingId(apiKey.id)}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
        </div>
        <ConnectToolCard />
      </div>
    </div>
  );
}
