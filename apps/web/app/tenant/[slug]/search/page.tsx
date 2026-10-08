import type { Metadata } from 'next';

import { getCategories, searchGuides } from '@/lib/tenant-api';

import { TenantSearchClient } from './search-client';

type PageParams = { slug: string };

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function TenantSearchPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<{ q?: string; c?: string }>;
}) {
  const { slug } = await params;
  const { q = '', c } = await searchParams;

  const [searchResponse, categoriesResponse] = await Promise.all([
    q.trim() === '' ? null : searchGuides(slug, q, c),
    getCategories(slug),
  ]);

  const counts = searchResponse?.counts ?? [];
  const totalGuides = counts.reduce((sum, item) => sum + item.count, 0);
  const results = searchResponse?.results ?? [];
  const emptyCategories = categoriesResponse?.categories ?? [];

  return (
    <main className="page tenant-content">
      <h1 className="sr-only">Search guides</h1>
      <TenantSearchClient
        slug={slug}
        initialQuery={q}
        initialCategory={c}
        counts={counts}
        totalGuides={totalGuides}
        initialResults={results}
        emptyCategories={emptyCategories}
      />
    </main>
  );
}
