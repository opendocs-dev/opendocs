import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { getSiteInfo } from '@/lib/site-api';

import '../site.css';
import { SiteNav } from './site-nav';
import { SiteAskAi } from './ask-ai/ask-ai-panel';

export async function generateMetadata(): Promise<Metadata> {
  const info = await getSiteInfo();

  if (!info) return { title: 'Not found', robots: { index: false, follow: false } };

  return {
    title: info.title,
    description: info.description || info.tagline || undefined,
    robots: { index: info.indexing, follow: info.indexing },
    icons: info.favicon_url ? { icon: info.favicon_url } : undefined,
    openGraph: {
      title: info.title,
      description: info.description || info.tagline || undefined,
      ...(info.og_image_url ? { images: [{ url: info.og_image_url }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
    },
  };
}

export default async function SiteLayout({ children }: { children: ReactNode }) {
  const info = await getSiteInfo();

  if (!info) notFound();

  // Ask AI is shown only when the operator turned the assistant on (C23 AC-21).
  const assistant = info.assistant?.enabled ? info.assistant : null;

  const customStyles: Record<string, string> = {};
  if (info.accent) {
    customStyles['--accent'] = info.accent;
    customStyles['--accent-soft'] = `${info.accent}1f`;
  }
  if (info.mark) {
    customStyles['--mark'] = info.mark;
  }
  if (info.font) {
    customStyles['--font'] = info.font;
    customStyles['fontFamily'] = info.font;
  }
  if (info.radius !== null && info.radius !== undefined) {
    customStyles['--radius'] = `${info.radius}px`;
  }

  return (
    <div
      className="tenant-page doc-page"
      data-preset={info.preset}
      style={Object.keys(customStyles).length > 0 ? (customStyles as React.CSSProperties) : undefined}
    >
      <SiteNav siteTitle={info.title} logoUrl={info.favicon_url} assistant={assistant} />
      {children}
      {assistant && <SiteAskAi siteTitle={info.title} logoUrl={info.favicon_url} assistant={assistant} />}
      <footer className="tenant-footer">
        <div className="tenant-footer-inner">
          <p className="tenant-footer-copy">© {new Date().getFullYear()} {info.title}. All rights reserved.</p>
          <nav className="tenant-footer-links" aria-label="Footer">
            <a href="#support">Contact support</a>
            <span aria-hidden="true">·</span>
            <a href="#privacy">Privacy</a>
          </nav>
          <p className="tenant-footer-powered">Powered by OpenDocs</p>
        </div>
      </footer>
    </div>
  );
}
