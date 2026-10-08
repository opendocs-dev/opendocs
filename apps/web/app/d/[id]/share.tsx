'use client';

import { useEffect, useState } from 'react';

import { shareLinks } from '@/lib/share';

import { PdfButton } from './pdf-button';
import { useDismissableMenu } from './use-dismissable-menu';

type ShareRowProps = { url: string; title: string };

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
      <path d="M16 6l-4-4-4 4" />
      <path d="M12 2v13" />
    </svg>
  );
}

export function ShareRow({ url, title }: ShareRowProps) {
  const [toast, setToast] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);
  const { open, setOpen, containerRef, menuRef } = useDismissableMenu();
  const links = shareLinks(url, title);

  useEffect(() => {
    setCanShare(typeof navigator.share === 'function');
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(timer);
  }, [toast]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setToast('Link copied');
    } catch {
      setToast(url);
    }
    setOpen(false);
  }

  async function nativeShare() {
    try {
      await navigator.share({ url, title });
    } catch {
      // User cancelled the share sheet or the platform rejected it.
    }
    setOpen(false);
  }

  return (
    <div className="bar-actions share-row" ref={containerRef}>
      <button
        type="button"
        className="btn"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ShareIcon />
        <span className="label">Share</span>
      </button>
      <PdfButton />
      {open && (
        <div className="menu" role="menu" ref={menuRef}>
          <button type="button" role="menuitem" onClick={copyLink}>
            Copy link
          </button>
          <a role="menuitem" href={links.whatsapp} target="_blank" rel="noopener noreferrer">
            Send on WhatsApp
          </a>
          <a role="menuitem" href={links.twitter} target="_blank" rel="noopener noreferrer">
            Post on X
          </a>
          <a role="menuitem" href={links.linkedin} target="_blank" rel="noopener noreferrer">
            Share on LinkedIn
          </a>
          {canShare && (
            <button type="button" role="menuitem" onClick={nativeShare}>
              Share…
            </button>
          )}
        </div>
      )}
      <div className="toast" role="status" hidden={!toast}>
        {toast}
      </div>
    </div>
  );
}
