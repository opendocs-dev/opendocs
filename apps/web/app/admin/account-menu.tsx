'use client';

import Link from 'next/link';
import { useRef, useState, useEffect } from 'react';
import { SignOutButton } from './sign-out-button';

interface AccountMenuProps {
  name?: string | null;
  email?: string | null;
  role: string;
  workspace?: string | null;
  initials: string;
}

export function AccountMenu({
  name,
  email,
  role,
  workspace,
  initials,
}: AccountMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

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
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    }

    if (isOpen) {
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('keydown', handleEscape);

      return () => {
        document.removeEventListener('click', handleClickOutside);
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [isOpen]);

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

          {workspace ? <div className="usec">{workspace}</div> : null}
          <div className="usep" role="separator" />

          <Link href="/" role="menuitem" onClick={() => setIsOpen(false)}>
            View docs site
          </Link>
          <Link href="/admin/account" role="menuitem" onClick={() => setIsOpen(false)}>
            Account settings
          </Link>
          <Link href="/admin/account#notifications" role="menuitem" onClick={() => setIsOpen(false)}>
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

    </>
  );
}
