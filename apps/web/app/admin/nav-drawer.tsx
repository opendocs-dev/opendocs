'use client';

import { useRef, useState, useEffect } from 'react';

export function NavDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => {
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [isOpen]);

  // Reflect the state on the shell so CSS can slide the drawer in
  useEffect(() => {
    document.getElementById('adm')?.setAttribute('data-nav-open', String(isOpen));
  }, [isOpen]);

  // Close drawer when a link is clicked
  useEffect(() => {
    if (isOpen) {
      const handleLinkClick = () => {
        setIsOpen(false);
      };

      const links = document.querySelectorAll('.adm-nav a');
      links?.forEach((link) => link.addEventListener('click', handleLinkClick));

      return () => {
        links?.forEach((link) => link.removeEventListener('click', handleLinkClick));
      };
    }
  }, [isOpen]);

  return (
    <button
      ref={buttonRef}
      type="button"
      className="nav-menu-btn"
      onClick={() => setIsOpen(!isOpen)}
      aria-controls="adm-nav"
      aria-expanded={isOpen}
      aria-label="Toggle menu"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeWidth="2" strokeLinecap="round" d="M3 6h18M3 12h18M3 18h18" />
      </svg>
    </button>
  );
}
