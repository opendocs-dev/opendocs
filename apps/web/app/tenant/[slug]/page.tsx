import Link from 'next/link';

import { getCategories, getGuides, getSiteInfo } from '@/lib/tenant-api';
import { formatGuideDate } from '@/lib/tenant-url';

import { SearchBox } from './search-box';

type PageParams = { slug: string };

const PAGE_SIZE = 20;

export default async function TenantHomePage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<{ offset?: string }>;
}) {
  const { slug } = await params;
  const { offset: rawOffset } = await searchParams;
  const offset = Number.isInteger(Number(rawOffset)) && Number(rawOffset) > 0 ? Math.min(Number(rawOffset), 1_000_000) : 0;

  const info = await getSiteInfo(slug);
  const guides = await getGuides(slug, PAGE_SIZE, offset);
  const categoriesResponse = await getCategories(slug);

  const shown = guides ? offset + guides.guides.length : 0;
  const hasMore = !!guides && guides.total > shown;
  const categories = categoriesResponse?.categories ?? [];

  return (
    <main className="page tenant-content">
      <section className="hero tenant-hero">
        <h1>{info?.title}</h1>
        {info?.tagline && <p className="tenant-tagline">{info.tagline}</p>}
        <SearchBox guideCount={info?.guides ?? guides?.total} />
      </section>

      {categories.length > 0 && (
        <section id="categories" className="tenant-categories">
          <h2>Browse by category</h2>
          <ul className="tenant-category-list">
            {categories.map((category) => {
              const sampleGuides =
                category.sample_guides ??
                guides?.guides.filter((g) => g.category?.slug === category.slug).slice(0, 2) ??
                [];

              return (
                <li key={category.slug} className="card tenant-category-card">
                  <div className="tenant-category-head">
                    <h3>
                      <Link href={`/c/${encodeURIComponent(category.slug)}`}>{category.name}</Link>
                    </h3>
                    <span className="tenant-category-count muted">
                      {category.guides} guide{category.guides === 1 ? '' : 's'}
                    </span>
                  </div>
                  {category.description && (
                    <p className="tenant-category-desc muted">{category.description}</p>
                  )}
                  {sampleGuides.length > 0 && (
                    <ul className="tenant-category-guides">
                      {sampleGuides.map((guide) => (
                        <li key={guide.slug}>
                          <span className="tenant-category-bullet" aria-hidden="true" />
                          <Link href={`/g/${encodeURIComponent(guide.slug)}`}>{guide.title}</Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section id="guides" className="tenant-guides">
        <h2>Recently updated</h2>
        {!guides || guides.guides.length === 0 ? (
          <div className="tenant-empty">
            <p>No guides yet</p>
            <p className="muted">Guides appear here once they are recorded and published.</p>
          </div>
        ) : (
          <>
            <ul className="tenant-guide-list">
              {guides.guides.map((guide) => {
                const dateStr = formatGuideDate(guide.updated_at);
                return (
                  <li key={guide.slug} className="card tenant-guide-card">
                    <div className="tenant-guide-head">
                      <h3 className="tenant-guide-title">
                        <Link href={`/g/${encodeURIComponent(guide.slug)}`}>{guide.title}</Link>
                      </h3>
                      <span className="tenant-guide-meta muted">
                        {guide.steps} step{guide.steps === 1 ? '' : 's'}{dateStr ? ` · ${dateStr}` : ''}
                      </span>
                    </div>
                    <p className="tenant-guide-summary muted">
                      {guide.category ? (
                        <>
                          <span className="tenant-guide-category">{guide.category.name}</span>
                          {guide.summary ? ` · ${guide.summary}` : ''}
                        </>
                      ) : (
                        guide.summary
                      )}
                    </p>
                  </li>
                );
              })}
            </ul>
            {hasMore && (
              <Link href={`/?offset=${shown}`} className="tenant-more">
                Show more
              </Link>
            )}
          </>
        )}
      </section>
    </main>
  );
}
