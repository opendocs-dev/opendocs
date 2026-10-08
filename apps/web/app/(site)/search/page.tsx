import type { Metadata } from 'next';

import { getCategories, searchGuides } from '@/lib/site-api';

import { SiteSearchClient } from './search-client';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function SiteSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; c?: string }>;
}) {
  const { q = '', c } = await searchParams;

  const [searchResponse, categoriesResponse] = await Promise.all([
    q.trim() === '' ? null : searchGuides(q, c),
    getCategories(),
  ]);

  const counts = searchResponse?.counts ?? [];
  const totalGuides = counts.reduce((sum, item) => sum + item.count, 0);
  const results = searchResponse?.results ?? [];
  const emptyCategories = categoriesResponse?.categories ?? [];

  return (
    <main className="page tenant-content">
      <h1 className="sr-only">Search guides</h1>
      <SiteSearchClient
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
