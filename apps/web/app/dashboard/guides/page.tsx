import Link from 'next/link';
import { getGuideList, getAdminCategories, getMe } from '@/lib/server-api';
import { categoryOption } from '@/lib/guide-labels';
import { GuidesTable } from './guides-table';

export const metadata = { title: 'Guides — OpenDocs' };

export default async function GuidesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; visibility?: string; cursor?: string }>;
}) {
  const params = await searchParams;
  const [guides, categories, me] = await Promise.all([
    getGuideList({
      q: params.q,
      category: params.category,
      visibility: params.visibility,
      cursor: params.cursor,
    }),
    getAdminCategories(),
    getMe(),
  ]);

  const hasFilters = Boolean(params.q || params.category || params.visibility);

  const guideCount = guides?.items.length ?? 0;
  const uncategorizedCount =
    guides?.items.filter(
      (g) => !g.category || g.category.status === 'suggested' || !g.category.id,
    ).length ?? 0;
  const subtitle =
    guides && guideCount > 0
      ? `${guideCount} ${guideCount === 1 ? 'guide' : 'guides'}${
          uncategorizedCount > 0 ? `, ${uncategorizedCount} without a category` : ''
        }`
      : null;

  return (
    <div className="stack">
      {/* Heading and new guide button */}
      <div className="adm-pane-header">
        <div>
          <h1>Guides</h1>
          {subtitle && <div>{subtitle}</div>}
        </div>
        <Link href="/dashboard/guides/new" className="btn btn-primary">
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M8 3v10M3 8h10" />
          </svg>
          New guide
        </Link>
      </div>

      {/* Filter bar */}
      <form method="get" className="filter-bar">
        <input
          type="text"
          name="q"
          placeholder="Search guides"
          defaultValue={params.q || ''}
        />
        <select name="category" defaultValue={params.category || ''}>
          <option value="">All categories</option>
          <option value="none">Uncategorized</option>
          {categories?.categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {categoryOption(cat)}
            </option>
          ))}
        </select>
        <select name="visibility" defaultValue={params.visibility || ''}>
          <option value="">Any status</option>
          <option value="published">Published</option>
          <option value="unlisted">Unlisted</option>
          <option value="draft">Draft</option>
        </select>
        <button type="submit" className="btn">
          Filter
        </button>
      </form>

      {/* Error alert */}
      {!guides ? (
        <p role="alert">
          Could not load your guides.{' '}
          <Link href="/dashboard/guides">Retry</Link>
        </p>
      ) : guides.items.length === 0 ? (
        /* Empty state */
        <p className="muted">
          {hasFilters ? (
            <>
              No guides match.{' '}
              <Link href="/dashboard/guides">Clear filters</Link>
            </>
          ) : (
            <>
              No guides yet.{' '}
              <Link href="/dashboard/guides/new">Create one</Link>
            </>
          )}
        </p>
      ) : (
        /* Guides table */
        <>
          <GuidesTable
            guides={guides.items}
            categories={categories?.categories || []}
            siteHost={me?.site_host || null}
          />

          {/* Load more */}
          {guides.next_cursor && (
            <p>
              <Link
                href={`/dashboard/guides?${new URLSearchParams({
                  ...(params.q && { q: params.q }),
                  ...(params.category && { category: params.category }),
                  ...(params.visibility && { visibility: params.visibility }),
                  cursor: guides.next_cursor,
                }).toString()}`}
              >
                Load more
              </Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}
