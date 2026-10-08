import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DocBar } from '@/app/d/[id]/doc-bar';
import type { RailItem } from '@/app/d/[id]/rail';
import { InlineBold, StepList } from '@/app/d/[id]/step-image';
import { getGuide, getGuides, getSiteInfo } from '@/lib/site-api';
import { HelpfulVote } from './helpful-vote';
import { buildDocMetadata } from '@/lib/metadata';
import { hostFromPageUrl } from '@/lib/step-url';
import { formatGuideFullDate, siteOrigin } from '@/lib/site-url';
import { tocLabel } from '@/lib/toc';

type PageParams = { guide: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { guide: guideSlug } = await params;
  const guide = await getGuide(guideSlug);

  if (!guide) {
    return { title: 'Guide not found', robots: { index: false, follow: false } };
  }

  const requestHeaders = await headers();
  const origin = siteOrigin(requestHeaders);
  const canonical = `${origin}/g/${encodeURIComponent(guide.slug)}`;

  const info = await getSiteInfo();
  const noindex = guide.visibility === 'unlisted' || guide.visibility === 'draft' || guide.noindex || info?.indexing === false;

  const metadata = buildDocMetadata(guide, canonical, info?.og_image_url ?? null);

  return {
    ...metadata,
    robots: noindex ? { index: false, follow: false } : { index: true, follow: true },
    alternates: { canonical },
  };
}

export default async function SiteGuidePage({ params }: { params: Promise<PageParams> }) {
  const { guide: guideSlug } = await params;
  const guide = await getGuide(guideSlug);

  if (!guide) notFound();

  const requestHeaders = await headers();
  const origin = siteOrigin(requestHeaders);
  const shareUrl = `${origin}/g/${encodeURIComponent(guide.slug)}`;
  const host = hostFromPageUrl(guide.steps[0]?.page_url);
  const items: RailItem[] = guide.steps.map((step) => ({ order: step.order, label: tocLabel(step) }));

  // Same-category guide list for left column (UI-R4 Finding 2)
  const categoryGuidesResponse = guide.category
    ? await getGuides(50, 0, guide.category.slug)
    : await getGuides(50, 0);
  const fetchedGuides = categoryGuidesResponse?.guides ?? [];
  const categoryGuides =
    fetchedGuides.length > 0 && fetchedGuides.some((g) => g.slug === guide.slug)
      ? fetchedGuides
      : [{ slug: guide.slug, title: guide.title }, ...fetchedGuides.filter((g) => g.slug !== guide.slug)];
  const categoryTitle = guide.category?.name ?? 'Guides';

  return (
    <div className="tenant-guide-page">
      <DocBar title={guide.title} host={host} shareUrl={shareUrl} items={items} />
      <main className="tenant-guide-layout tenant-two-col">
        <aside aria-label={guide.category ? `${guide.category.name} guides` : 'Guides'} className="tenant-category-side">
          <h4>{categoryTitle}</h4>
          {categoryGuides.map((g) => (
            <Link
              key={g.slug}
              href={`/g/${encodeURIComponent(g.slug)}`}
              aria-current={g.slug === guide.slug ? 'page' : undefined}
            >
              <span>{g.title}</span>
            </Link>
          ))}
        </aside>

        <div className="tenant-guide-main">
          <nav className="tenant-breadcrumb" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            {guide.category ? (
              <>
                <span className="tenant-breadcrumb-sep" aria-hidden="true">›</span>
                <Link href={`/c/${encodeURIComponent(guide.category.slug)}`}>{guide.category.name}</Link>
              </>
            ) : null}
          </nav>

          <header className="tenant-guide-hero">
            <h1>
              <InlineBold text={guide.title} />
              {guide.visibility === 'draft' ? <span className="tenant-draft-badge">Draft</span> : null}
            </h1>
            <div className="tenant-guide-meta">
              <span>{guide.steps.length} steps</span>
              {guide.updated_at ? <span>Updated {formatGuideFullDate(guide.updated_at)}</span> : null}
              {host ? <span>Recorded on {host}</span> : null}
            </div>
            {guide.summary ? <p className="tenant-guide-lede">{guide.summary}</p> : null}
          </header>

          <StepList steps={guide.steps} />

          {guide.visibility === 'draft' ? null : <HelpfulVote guideSlug={guide.slug} />}

          {(guide.prev || guide.next) && (
            <nav className="tenant-guide-nav" aria-label="More guides">
              {guide.prev ? (
                <Link
                  href={`/g/${encodeURIComponent(guide.prev.slug)}`}
                  className="tenant-guide-nav-card tenant-guide-nav-prev"
                >
                  <span className="tenant-guide-nav-label">Previous:</span>
                  <span className="tenant-guide-nav-title">{guide.prev.title}</span>
                </Link>
              ) : (
                <div className="tenant-guide-nav-empty" aria-hidden="true" />
              )}
              {guide.next ? (
                <Link
                  href={`/g/${encodeURIComponent(guide.next.slug)}`}
                  className="tenant-guide-nav-card tenant-guide-nav-next"
                >
                  <span className="tenant-guide-nav-label">Next:</span>
                  <span className="tenant-guide-nav-title">{guide.next.title}</span>
                </Link>
              ) : (
                <div className="tenant-guide-nav-empty" aria-hidden="true" />
              )}
            </nav>
          )}

        </div>
      </main>
    </div>
  );
}
