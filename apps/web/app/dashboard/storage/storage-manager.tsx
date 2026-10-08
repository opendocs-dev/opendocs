'use client';

import { useState } from 'react';
import { apiErrorMessage } from '@/lib/site-address';
import type { StorageConnectionInfo, StorageInfo } from '@/lib/server-api';
import { DriveConnectForm } from './drive-connect-form';
import { S3ConnectForm } from './s3-connect-form';

interface StorageManagerProps {
  initial: StorageInfo;
}

/** Reads an error body the same way site-address-form/custom-domain-form do. */
async function parsedError(response: Response, fallback: string): Promise<string> {
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return apiErrorMessage(parsed, fallback);
}

export const kindLabel = (kind: string): string =>
  kind === 'gdrive'
    ? 'Google Drive'
    : kind === 's3'
    ? 'S3-compatible bucket'
    : kind === 'opendocs'
    ? 'OpenDocs storage'
    : kind;

export const DISCONNECT_WARNING_MESSAGE =
  'Images already stored there will stop loading and new uploads will fail until you choose another destination.';

export function getDisconnectConfirmMessage(kind: string): string {
  return `Disconnect ${kindLabel(kind)}? ${DISCONNECT_WARNING_MESSAGE}`;
}

export function canDisconnect(activeKind: string | null, targetKind: string): boolean {
  return activeKind !== targetKind;
}

function ProviderTile({ kind }: { kind: 'opendocs' | 'gdrive' | 's3' }) {
  if (kind === 'opendocs') {
    return (
      <div
        aria-hidden="true"
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          background: 'var(--a-soft)',
          border: '1px solid color-mix(in srgb, var(--a-brand) 30%, transparent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--a-brand)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      </div>
    );
  }

  if (kind === 'gdrive') {
    return (
      <div
        aria-hidden="true"
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          background: 'var(--a-bg)',
          border: '1px solid var(--a-line)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <svg width="20" height="18" viewBox="0 0 87.3 78" fill="none">
          <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066DA" />
          <path d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44C.4 49.9 0 51.45 0 53h27.5z" fill="#00AC47" />
          <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l6.1 10.6z" fill="#EA4335" />
          <path d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832D" />
          <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684FC" />
          <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25l16.15 28h27.5c0-1.55-.4-3.1-1.2-4.5z" fill="#FFBA00" />
        </svg>
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      style={{
        width: 36,
        height: 36,
        borderRadius: 8,
        background: 'var(--a-bg)',
        border: '1px solid var(--a-line)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e05307" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7c0-2 4-3 8-3s8 1 8 3v10c0 2-4 3-8 3s-8-1-8-3V7z" />
        <ellipse cx="12" cy="7" rx="8" ry="3" />
        <path d="M4 12c0 2 4 3 8 3s8-1 8-3" />
      </svg>
    </div>
  );
}

export function StorageManager({ initial }: StorageManagerProps) {
  const [storage, setStorage] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const currentActive = storage.active_kind ?? 'opendocs';
  const [selectedDestination, setSelectedDestination] = useState<string>(currentActive);

  async function refresh(): Promise<boolean> {
    try {
      const response = await fetch('/api/v1/storage', { credentials: 'include', cache: 'no-store' });
      if (!response.ok) return false;
      const body = (await response.json()) as StorageInfo;
      setStorage(body);
      setSelectedDestination(body.active_kind ?? 'opendocs');
      return true;
    } catch {
      return false;
    }
  }

  async function connect(kind: 'gdrive' | 's3', body: Record<string, unknown>) {
    setPending(`connect-${kind}`);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/v1/storage/connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ kind, ...body }),
      });
      if (!response.ok) {
        setError(await parsedError(response, `Error connecting ${kindLabel(kind)} (${response.status})`));
        return;
      }
      setNotice(`${kindLabel(kind)} connected. Run a test before activating it.`);
      if (!(await refresh())) setError('Could not load storage information.');
    } catch {
      setError(`Failed to connect ${kindLabel(kind)}. Please try again.`);
    } finally {
      setPending(null);
    }
  }

  async function testConnection(kind: string) {
    setPending(`test-${kind}`);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/v1/storage/connections/${encodeURIComponent(kind)}/test`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        setError(await parsedError(response, `Storage test failed (${response.status})`));
        if (!(await refresh())) setError('Could not load storage information.');
        return;
      }
      setNotice(`${kindLabel(kind)} test passed.`);
      if (!(await refresh())) setError('Could not load storage information.');
    } catch {
      setError('Failed to run the storage test. Please try again.');
    } finally {
      setPending(null);
    }
  }

  async function activate(kind: string) {
    setPending(`activate-${kind}`);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/v1/storage/connections/${encodeURIComponent(kind)}/activate`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        setError(await parsedError(response, `Error activating ${kindLabel(kind)} (${response.status})`));
        return;
      }
      setNotice(`${kindLabel(kind)} is now the active storage destination.`);
      if (!(await refresh())) setError('Could not load storage information.');
    } catch {
      setError(`Failed to activate ${kindLabel(kind)}. Please try again.`);
    } finally {
      setPending(null);
    }
  }

  async function handleSave() {
    await activate(selectedDestination);
  }

  async function disconnect(kind: string) {
    if (!canDisconnect(storage.active_kind, kind)) {
      setError(
        `Cannot disconnect ${kindLabel(kind)} while it is the active destination. Select another destination above and save first.`
      );
      return;
    }
    if (!window.confirm(getDisconnectConfirmMessage(kind))) {
      return;
    }
    setPending(`disconnect-${kind}`);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/v1/storage/connections/${encodeURIComponent(kind)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) {
        setError(await parsedError(response, `Error disconnecting ${kindLabel(kind)} (${response.status})`));
        return;
      }
      setNotice(`${kindLabel(kind)} disconnected.`);
      if (!(await refresh())) setError('Could not load storage information.');
    } catch {
      setError(`Failed to disconnect ${kindLabel(kind)}. Please try again.`);
    } finally {
      setPending(null);
    }
  }

  const activeConnection = storage.connections.find((c) => c.kind === storage.active_kind) ?? null;
  const activeFailed = activeConnection?.status === 'failed';
  const connectionFor = (kind: string): StorageConnectionInfo | undefined =>
    storage.connections.find((c) => c.kind === kind);

  const isDriveConnected = storage.connections.some((c) => c.kind === 'gdrive' && c.status === 'connected');
  const isS3Connected = storage.connections.some((c) => c.kind === 's3' && c.status === 'connected');
  const canSave = pending === null && selectedDestination !== currentActive;

  const hasUsage = Boolean(storage.usage || storage.plan === 'free');
  const usedMiB = storage.usage ? Math.round(storage.usage.bytes_used / (1024 * 1024)) : 0;
  const limitMiB = storage.usage ? Math.round(storage.usage.bytes_limit / (1024 * 1024)) : 100;
  const percent = limitMiB > 0 ? Math.min(100, Math.round((usedMiB / limitMiB) * 100)) : 0;

  return (
    <>
      <div className="adm-pane-header">
        <div>
          <h1>Storage</h1>
          <div>Choose where your guide images live</div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canSave}
          onClick={handleSave}
        >
          {pending === `activate-${selectedDestination}` ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div className="callout neutral">
        <svg
          width="18"
          height="18"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <circle cx="10" cy="10" r="9" />
          <line x1="10" y1="9" x2="10" y2="15" strokeLinecap="round" />
          <circle cx="10" cy="5.5" r="1" fill="currentColor" />
        </svg>
        <span className="sp">
          Images already stored stay where they are. Guides keep working when you switch.
        </span>
      </div>

      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}

      <section className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <ProviderTile kind="opendocs" />
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3>OpenDocs storage</h3>
              <span className="badge">Default</span>
              {!storage.active_kind && <span className="badge badge-ok">Active</span>}
            </div>
          </div>
        </div>
        <p className="sub" style={{ marginTop: '8px' }}>
          Included on every plan. Free is limited to 100 MiB of guide images.
        </p>
        {hasUsage && (
          <div style={{ marginTop: '14px', maxWidth: '420px' }}>
            <div
              className="bar"
              role="progressbar"
              aria-label="Storage used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <div className="bar-fill" style={{ width: `${percent}%` }} />
            </div>
            <div className="sub" style={{ fontSize: '13px', marginTop: '4px' }}>
              {usedMiB} of {limitMiB} MiB used
            </div>
          </div>
        )}
      </section>

      <ConnectionCard
        kind="gdrive"
        label="Google Drive"
        connection={connectionFor('gdrive')}
        pending={pending}
        activeKind={storage.active_kind}
        isAllowed={storage.allowed_kinds.includes('gdrive')}
        onTest={testConnection}
        onDisconnect={disconnect}
      >
        <DriveConnectForm
          disabled={pending === 'connect-gdrive' || !storage.allowed_kinds.includes('gdrive')}
          isPending={pending === 'connect-gdrive'}
          onSubmit={(fields) => connect('gdrive', fields)}
        />
      </ConnectionCard>

      <ConnectionCard
        kind="s3"
        label="S3-compatible bucket"
        connection={connectionFor('s3')}
        pending={pending}
        activeKind={storage.active_kind}
        isAllowed={storage.allowed_kinds.includes('s3')}
        onTest={testConnection}
        onDisconnect={disconnect}
      >
        <S3ConnectForm
          disabled={pending === 'connect-s3' || !storage.allowed_kinds.includes('s3')}
          isPending={pending === 'connect-s3'}
          onSubmit={(fields) => connect('s3', fields)}
        />
      </ConnectionCard>

      <section className="card">
        <h3>Where new images go</h3>
        <div className="stack" style={{ gap: '10px', marginTop: '12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="radio"
              name="destination"
              value="opendocs"
              checked={selectedDestination === 'opendocs'}
              onChange={() => setSelectedDestination('opendocs')}
            />
            <span>OpenDocs storage</span>
          </label>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: isDriveConnected ? 'pointer' : 'not-allowed',
              opacity: isDriveConnected ? 1 : 0.6,
            }}
          >
            <input
              type="radio"
              name="destination"
              value="gdrive"
              checked={selectedDestination === 'gdrive'}
              disabled={!isDriveConnected}
              onChange={() => setSelectedDestination('gdrive')}
            />
            <span>My Google Drive</span>
          </label>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: isS3Connected ? 'pointer' : 'not-allowed',
              opacity: isS3Connected ? 1 : 0.6,
            }}
          >
            <input
              type="radio"
              name="destination"
              value="s3"
              checked={selectedDestination === 's3'}
              disabled={!isS3Connected}
              onChange={() => setSelectedDestination('s3')}
            />
            <span>My S3 bucket</span>
          </label>
        </div>
        <p className="sub" style={{ marginTop: '12px' }}>
          If your storage is unreachable, images stop loading until it is back. OpenDocs shows a warning here.
        </p>
        {activeFailed && activeConnection ? (
          <div className="msg bad" style={{ marginTop: '12px' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path stroke="currentColor" strokeWidth="2" d="M11 5L5 11M5 5l6 6" />
            </svg>
            <span role="alert">
              The active {kindLabel(activeConnection.kind)} connection failed its last test. Uploads are
              <strong> not</strong> silently falling back to OpenDocs storage — fix or disconnect it below.
            </span>
          </div>
        ) : null}
      </section>
    </>
  );
}

interface ConnectionCardProps {
  kind: 'gdrive' | 's3';
  label: string;
  connection: StorageConnectionInfo | undefined;
  pending: string | null;
  activeKind: string | null;
  isAllowed: boolean;
  onTest: (kind: string) => void;
  onDisconnect: (kind: string) => void;
  children: React.ReactNode;
}

function ConnectionCard({
  kind,
  label,
  connection,
  pending,
  activeKind,
  isAllowed,
  onTest,
  onDisconnect,
  children,
}: ConnectionCardProps) {
  const isActive = activeKind === kind;
  const isLocked = !isAllowed;

  return (
    <section className={`card card-lock ${isLocked ? 'is-locked' : ''}`} data-need={kind === 'gdrive' ? 'pro' : 'enterprise'}>
      {isLocked && (
        <div className="card-veil">
          <div className="card-veil-box">
            <span className="badge badge-ai" style={{ marginBottom: '8px' }}>
              {kind === 'gdrive' ? 'Pro' : 'Enterprise'}
            </span>
            <p>
              <b>{kind === 'gdrive' ? 'Your own Google Drive is on Pro' : 'S3 storage is on Enterprise'}</b>
            </p>
            <p className="sub" style={{ margin: '6px 0 0' }}>
              {kind === 'gdrive'
                ? 'Keep guide images in your Drive.'
                : 'Use your own bucket on AWS S3, R2, MinIO or any S3-compatible service.'}
            </p>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <ProviderTile kind={kind} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h3>{label}</h3>
            {kind === 's3' && <span className="badge badge-ai">Enterprise</span>}
          </div>
        </div>
        {connection && !isLocked ? (
          <div className="adm-buttons">
            <button type="button" className="btn" disabled={pending !== null} onClick={() => onTest(kind)}>
              {pending === `test-${kind}` ? 'Testing...' : 'Test connection'}
            </button>
            <button type="button" className="btn btn-danger" disabled={pending !== null} onClick={() => onDisconnect(kind)}>
              {pending === `disconnect-${kind}` ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
        ) : null}
      </div>

      {connection && !isLocked ? (
        <>
          <div className="inl" style={{ justifyContent: 'space-between', gap: '8px', marginTop: '12px' }}>
            <span>Status</span>
            <span
              className={`badge ${
                connection.status === 'connected' ? 'badge-ok' : connection.status === 'failed' ? 'badge-bad' : 'badge-warn'
              }`}
            >
              {connection.status === 'connected' ? 'Connected' : connection.status === 'failed' ? 'Failed' : 'Untested'}
            </span>
          </div>
          {isActive ? (
            <div className="inl" style={{ justifyContent: 'space-between', gap: '8px', marginTop: '8px' }}>
              <span>Active destination</span>
              <span className="badge badge-ok">Active</span>
            </div>
          ) : null}
          {connection.last_tested_at ? (
            <p className="sub" style={{ marginTop: '8px' }}>
              Last tested {new Date(connection.last_tested_at).toLocaleString()}
            </p>
          ) : null}
        </>
      ) : (
        children
      )}
    </section>
  );
}
