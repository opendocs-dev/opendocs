import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getCategories, getGuides, getSiteInfo } from '@/lib/tenant-api';
import { formatGuideDate, tenantOrigin } from '@/lib/tenant-url';

type PageParams = { slug: string; category: string };

const PAGE_SIZE = 20;

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { slug, category: categorySlug } = await params;
  const categoriesResponse = await getCategories(slug);
  const category = categoriesResponse?.categories.find((c) => c.slug === categorySlug);

  if (!category) {
    return { title: 'Category not found', robots: { index: false, follow: false } };
  }

  const info = await getSiteInfo(slug);
  const requestHeaders = await headers();
  const origin = tenantOrigin(requestHeaders);
  const canonical = `${origin}/c/${encodeURIComponent(categorySlug)}`;

  const noindex = info?.indexing === false;

  return {
    title: info?.title ? `${category.name} — ${info.title}` : category.name,
    description: category.description || undefined,
    robots: { index: !noindex, follow: !noindex },
    alternates: { canonical },
  };
}

export default async function TenantCategoryPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<{ offset?: string }>;
}) {
  const { slug, category: categorySlug } = await params;
  const { offset: rawOffset } = await searchParams;
  const offset = Number.isInteger(Number(rawOffset)) && Number(rawOffset) > 0 ? Math.min(Number(rawOffset), 1_000_000) : 0;

  const categoriesResponse = await getCategories(slug);
  const allCategories = categoriesResponse?.categories ?? [];
  const category = allCategories.find((c) => c.slug === categorySlug);

  if (!category) notFound();

  const guides = await getGuides(slug, PAGE_SIZE, offset, categorySlug);

  const shown = guides ? offset + guides.guides.length : 0;
  const hasMore = !!guides && guides.total > shown;

  return (
    <main className="page tenant-content">
      <div className="tenant-category-layout tenant-two-col">
        <aside aria-label="Categories" className="tenant-category-side">
          <h4>Categories</h4>
          {allCategories.map((cat) => (
            <Link
              key={cat.slug}
              href={`/c/${encodeURIComponent(cat.slug)}`}
              aria-current={cat.slug === categorySlug ? 'page' : undefined}
            >
              <span>{cat.name}</span>
              <span className="tenant-category-side-count">{cat.guides}</span>
            </Link>
          ))}
        </aside>

        <div className="tenant-category-main">
          <nav className="tenant-breadcrumb" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            <span className="tenant-breadcrumb-sep" aria-hidden="true">›</span>
            <span>{category.name}</span>
          </nav>

          <header className="tenant-category-header">
            <h1>{category.name}</h1>
            {category.description && <p className="tenant-category-desc">{category.description}</p>}
          </header>

          <section className="tenant-guides">
            {!guides || guides.guides.length === 0 ? (
              <div className="tenant-empty">
                <p>No guides in this category</p>
                <p className="muted">
                  <Link href="/">Back home</Link>
                </p>
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
                        {guide.summary && (
                          <p className="tenant-guide-summary muted">{guide.summary}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {hasMore && (
                  <Link href={`/c/${encodeURIComponent(categorySlug)}?offset=${shown}`} className="tenant-more">
                    Show more
                  </Link>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
