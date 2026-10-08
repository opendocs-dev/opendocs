'use client';

import Link from 'next/link';
import { useRef, useState, useEffect } from 'react';
import { SignOutButton } from '../dashboard/sign-out-button';

interface PlatformAccountMenuProps {
  name?: string | null;
  role: string;
  initials: string;
}

export function PlatformAccountMenu({ name, role, initials }: PlatformAccountMenuProps) {
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

  return (
    <div className="adm-user-wrap">
      <button
        ref={buttonRef}
        className="adm-user-btn"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <div className="av">{initials}</div>
        <div className="adm-user-name">
          <b>{name || 'Staff'}</b>
          <small>{role}</small>
        </div>
        <svg className="adm-user-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M6 10l4-4 4 4" />
        </svg>
      </button>

      <div
        ref={menuRef}
        className={`umenu ${isOpen ? 'open' : ''}`}
        style={{ display: isOpen ? 'block' : undefined }}
        role="menu"
      >
        <Link href="/dashboard/account" role="menuitem" onClick={() => setIsOpen(false)}>
          Account settings
        </Link>
        <SignOutButton />
      </div>
    </div>
  );
}
