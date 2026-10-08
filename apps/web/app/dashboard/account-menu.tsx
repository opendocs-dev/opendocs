'use client';

import Link from 'next/link';
import { useRef, useState, useEffect } from 'react';
import { SignOutButton } from './sign-out-button';

export type WorkspaceItem = {
  id: string;
  name: string;
  slug?: string;
};

interface AccountMenuProps {
  name?: string | null;
  email?: string | null;
  role: string;
  workspace?: string | null;
  activeWorkspaceId?: string | null;
  workspaces?: WorkspaceItem[];
  initials: string;
}

export function AccountMenu({
  name,
  email,
  role,
  workspace,
  activeWorkspaceId,
  workspaces,
  initials,
}: AccountMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        !buttonRef.current?.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (showCreateDialog) {
          setShowCreateDialog(false);
          setCreateError(null);
          setNewWorkspaceName('');
        } else {
          setIsOpen(false);
          buttonRef.current?.focus();
        }
      }
    }

    if (isOpen || showCreateDialog) {
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('keydown', handleEscape);

      return () => {
        document.removeEventListener('click', handleClickOutside);
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [isOpen, showCreateDialog]);

  useEffect(() => {
    const adm = document.getElementById('adm');
    if (isOpen) {
      adm?.setAttribute('data-menu-open', 'true');
    } else {
      adm?.removeAttribute('data-menu-open');
    }
    return () => {
      adm?.removeAttribute('data-menu-open');
    };
  }, [isOpen]);

  const displayRole = role ? role.charAt(0).toUpperCase() + role.slice(1).toLowerCase() : '';

  const allWorkspaces: WorkspaceItem[] =
    workspaces && workspaces.length > 0
      ? workspaces
      : workspace
        ? [{ id: activeWorkspaceId || 'current', name: workspace }]
        : [];

  async function handleSwitchWorkspace(targetOrgId: string) {
    if (activeWorkspaceId && targetOrgId === activeWorkspaceId) {
      setIsOpen(false);
      return;
    }
    setSwitching(true);
    try {
      const response = await fetch('/api/auth/organization/set-active', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ organizationId: targetOrgId }),
      });
      if (response.ok) {
        window.location.href = '/dashboard';
      }
    } finally {
      setSwitching(false);
    }
  }

  async function handleCreateWorkspace(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newWorkspaceName.trim();
    if (!trimmed) return;

    setCreating(true);
    setCreateError(null);

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
        setCreateError(data?.message || 'Could not create workspace');
      }
    } catch {
      setCreateError('Could not create workspace');
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div className="adm-user-wrap" data-menu-open={isOpen ? 'true' : undefined}>
        <button
          ref={buttonRef}
          className="adm-user-btn"
          onClick={() => setIsOpen(!isOpen)}
          aria-haspopup="menu"
          aria-expanded={isOpen}
        >
          <div className="av">{initials}</div>
          <div className="adm-user-name">
            <b>{name || 'User'}</b>
            <small>{displayRole}</small>
          </div>
          <svg className="adm-user-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M6 10l4-4 4 4" />
          </svg>
        </button>

        <div ref={menuRef} className="umenu" role="menu">
          <div className="uh">
            <div className="av">{initials}</div>
            <div>
              <b>{name || 'User'}</b>
              {email ? <small>{email}</small> : <small>{displayRole}</small>}
            </div>
          </div>

          <div className="usep" role="separator" />

          <div className="usec">Workspaces</div>
          {allWorkspaces.map((ws) => {
            const isCurrent =
              (activeWorkspaceId && ws.id === activeWorkspaceId) ||
              (!activeWorkspaceId && ws.name === workspace) ||
              allWorkspaces.length === 1;
            return (
              <button
                key={ws.id}
                type="button"
                className={`umenu-item ${isCurrent ? 'cur' : ''}`}
                role="menuitem"
                disabled={switching}
                onClick={() => handleSwitchWorkspace(ws.id)}
              >
                <span>{ws.name}</span>
                {isCurrent && (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-label="Current workspace">
                    <path
                      d="M13.25 4.75L6 12L2.75 8.75"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            );
          })}

          <button
            type="button"
            className="umenu-item"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              setShowCreateDialog(true);
            }}
          >
            + Create workspace
          </button>

          <div className="usep" role="separator" />

          <Link href="/dashboard/account" role="menuitem" onClick={() => setIsOpen(false)}>
            Account settings
          </Link>
          <Link href="/dashboard/account#notifications" role="menuitem" onClick={() => setIsOpen(false)}>
            Notifications
          </Link>
          <a
            href="https://github.com/opendocs-dev/opendocs"
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            onClick={() => setIsOpen(false)}
          >
            Help and docs
          </a>
          <SignOutButton />
        </div>
      </div>

      {showCreateDialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-ws-dialog-title"
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
              maxWidth: '440px',
              width: '100%',
              boxShadow: '0 8px 30px rgba(0, 0, 0, 0.12)',
            }}
          >
            <h2 id="create-ws-dialog-title">Create workspace</h2>
            <p className="sub" style={{ margin: 0 }}>
              Create a new workspace for your documentation.
            </p>
            {createError && (
              <p className="msg bad" role="alert">
                {createError}
              </p>
            )}
            <form onSubmit={handleCreateWorkspace} className="stack" style={{ gap: '14px' }}>
              <div className="fld" style={{ marginTop: 0 }}>
                <label htmlFor="create-ws-name">Workspace name</label>
                <input
                  id="create-ws-name"
                  type="text"
                  required
                  placeholder="e.g. Acme Docs"
                  value={newWorkspaceName}
                  disabled={creating}
                  autoFocus
                  onChange={(e) => setNewWorkspaceName(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={creating}
                  onClick={() => {
                    setShowCreateDialog(false);
                    setCreateError(null);
                    setNewWorkspaceName('');
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={creating || !newWorkspaceName.trim()}
                >
                  {creating ? 'Creating…' : 'Create workspace'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
