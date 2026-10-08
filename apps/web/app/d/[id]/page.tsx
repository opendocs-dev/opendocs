import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import type { GetDocResponse } from '@opendocs/core';
import { apiOrigin } from '@/lib/server-api';
import { absoluteDocUrl, absoluteMetadataUrl } from '@/lib/doc-url';
import { buildDocMetadata } from '@/lib/metadata';
import { tocLabel } from '@/lib/toc';
import { hostFromPageUrl } from '@/lib/step-url';

import { InlineBold, StepList } from './step-image';
import { DocBar } from './doc-bar';
import { DocRail } from './doc-rail';
import type { RailItem } from './rail';
import { bricolageGrotesque, figtree } from './fonts';

type PageParams = { id: string };

async function fetchDoc(id: string): Promise<GetDocResponse | null> {
  // The cookie lets a signed-in member open a draft; anonymous visitors get a 404 for it (C23 AC-09).
  const cookie = (await headers()).get('cookie') ?? '';
  const response = await fetch(`${apiOrigin()}/api/v1/docs/${encodeURIComponent(id)}`, {
    cache: 'no-store',
    ...(cookie ? { headers: { cookie } } : {}),
  });

  if (!response.ok) return null;

  return (await response.json()) as GetDocResponse;
}

/** Public docs-site URL for this doc, when it is published; null on any failure. */
async function fetchCanonicalUrl(id: string): Promise<string | null> {
  try {
    const response = await fetch(`${apiOrigin()}/api/v1/docs/${encodeURIComponent(id)}/canonical`, {
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return ((await response.json()) as { url: string }).url;
  } catch {
    // The canonical link is optional: an API hiccup must never break the apex doc page.
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { id } = await params;
  const doc = await fetchDoc(id);

  if (!doc) {
    return { title: 'Doc not found', robots: { index: false, follow: false } };
  }

  const url = await absoluteMetadataUrl(id);
  const metadata = buildDocMetadata(doc, url);

  const canonicalUrl = await fetchCanonicalUrl(id);
  if (canonicalUrl) return { ...metadata, alternates: { canonical: canonicalUrl } };

  return metadata;
}

export default async function DocPage({ params }: { params: Promise<PageParams> }) {
  const { id } = await params;
  const doc = await fetchDoc(id);

  if (!doc) notFound();

  const url = await absoluteDocUrl(id);
  const printedAt = new Date().toLocaleString();
  const host = hostFromPageUrl(doc.steps[0]?.page_url);
  const items: RailItem[] = doc.steps.map((step) => ({ order: step.order, label: tocLabel(step) }));

  return (
    <div className={`doc-page ${bricolageGrotesque.variable} ${figtree.variable}`}>
      <div className="print-only print-header">
        <p>{url}</p>
        <p>Printed {printedAt}</p>
      </div>
      <DocBar title={doc.title} host={host} shareUrl={url} items={items} docId={id} />
      <main className="page">
        <section className="hero">
          <h1>
            <InlineBold text={doc.title} />
          </h1>
          <div className="meta">
            <span>
              <b>{doc.steps.length}</b> steps
            </span>
            {host && <span>On {host}</span>}
          </div>
        </section>
        <div className="layout">
          <DocRail items={items} docId={id} />
          <StepList steps={doc.steps} docId={id} />
        </div>
        <footer className="foot">
          <span>Recorded by an AI agent with OpenDocs. Sensitive fields are masked before capture.</span>
          <a href="https://github.com/opendocs-dev/opendocs" target="_blank" rel="noopener noreferrer">
            Make a guide like this
          </a>
        </footer>
      </main>
    </div>
  );
}
