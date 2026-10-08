'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { PublicAssistantConfig } from '@/lib/site-api';

type SiteNavProps = {
  siteTitle: string;
  logoUrl?: string | null;
  assistant?: PublicAssistantConfig | null;
};

/** Site header: brand + nav links + Ask AI + Open Brand CTA, plus a keyboard-operable menu button below 640px. */
export function SiteNav({ siteTitle, logoUrl, assistant }: SiteNavProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const isHomePage = !pathname || pathname === '/';

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const cleanBrand = siteTitle.replace(/\s+(Help|Docs|Documentation)$/i, '') || siteTitle;
  const initial = siteTitle ? siteTitle.charAt(0).toUpperCase() : 'O';

  return (
    <header className="tenant-topbar">
      <div className="tenant-topbar-inner">
        <Link href="/" className="tenant-brand">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="tenant-logo-img" />
          ) : (
            <span className="tenant-logo-mark" aria-hidden="true">
              {initial}
            </span>
          )}
          <span className="tenant-brand-text">{siteTitle}</span>
        </Link>
        <nav className="site-nav-links" aria-label="Primary">
          <Link href="/#guides">Guides</Link>
          <Link href="/#categories">Categories</Link>
          <a href="#support">Contact support</a>
        </nav>
        {!isHomePage && (
          <form className="site-nav-search" action="/search" role="search">
            <svg
              className="site-nav-search-icon"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              name="q"
              placeholder="Search guides..."
              autoComplete="off"
              className="site-nav-search-input"
            />
          </form>
        )}
        <div className="site-nav-actions">
          {assistant?.enabled && (
            <a
              href="#ask-ai"
              className="tenant-ask-ai-pill"
              onClick={(e) => {
                e.preventDefault();
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('open-ask-ai'));
                }
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ marginRight: 6 }}
                aria-hidden="true"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              {assistant?.button_label || 'Ask AI'}
            </a>
          )}
          <a href="/" className="tenant-cta-button">
            Open {cleanBrand}
          </a>
          <button
            type="button"
            className="tenant-menu-button"
            aria-expanded={open}
            aria-controls="tenant-mobile-menu"
            onClick={() => setOpen(!open)}
          >
            Menu
          </button>
        </div>
      </div>
      <nav id="tenant-mobile-menu" className="tenant-mobile-menu" aria-label="Menu" hidden={!open}>
        <Link href="/" onClick={() => setOpen(false)}>
          {siteTitle}
        </Link>
        <Link href="/#guides" onClick={() => setOpen(false)}>
          Guides
        </Link>
        <Link href="/#categories" onClick={() => setOpen(false)}>
          Categories
        </Link>
        <a href="#support" onClick={() => setOpen(false)}>
          Contact support
        </a>
        <Link href="/search" onClick={() => setOpen(false)}>
          Search
        </Link>
      </nav>
    </header>
  );
}
