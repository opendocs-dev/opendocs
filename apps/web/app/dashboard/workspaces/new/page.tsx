'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function NewWorkspacePage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setCreating(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/organization/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: trimmed }),
      });

      if (response.ok) {
        window.location.href = '/dashboard';
      } else {
        const data = await response.json();
        setError(data?.message || 'Could not create workspace');
      }
    } catch {
      setError('Could not create workspace');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: 480 }}>
      <div className="adm-pane-header">
        <div>
          <h1>Create workspace</h1>
          <div className="sub">Create a new workspace for your documentation.</div>
        </div>
      </div>

      {error && (
        <p className="msg bad" role="alert">
          {error}
        </p>
      )}

      <div className="card">
        <form onSubmit={handleSubmit} className="stack" style={{ gap: '16px' }}>
          <div className="fld" style={{ marginTop: 0 }}>
            <label htmlFor="ws-name">Workspace name</label>
            <input
              id="ws-name"
              type="text"
              required
              placeholder="e.g. Acme Docs"
              value={name}
              disabled={creating}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Link href="/dashboard" className="btn btn-secondary">
              Cancel
            </Link>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={creating || !name.trim()}
            >
              {creating ? 'Creating…' : 'Create workspace'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
