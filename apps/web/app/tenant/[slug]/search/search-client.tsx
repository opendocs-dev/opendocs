'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import type { SearchResult } from '@/lib/tenant-api';
import { highlightWords, searchHref } from '@/lib/tenant-url';

export type SearchCategoryCount = {
  slug: string;
  name: string;
  count: number;
};

type SearchClientProps = {
  slug: string;
  initialQuery: string;
  initialCategory?: string;
  counts: SearchCategoryCount[];
  totalGuides: number;
  initialResults: SearchResult[];
  emptyCategories?: { slug: string; name: string }[];
};

function HighlightText({ text, query }: { text?: string | null; query: string }) {
  const parts = highlightWords(text ?? '', query);
  return (
    <>
      {parts.map((part, index) =>
        part.mark ? (
          <mark key={index} className="tenant-search-highlight">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

export function TenantSearchClient({
  initialQuery,
  initialCategory,
  counts,
  totalGuides,
  initialResults,
  emptyCategories,
}: SearchClientProps) {
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState<string | undefined>(initialCategory);
  const [results, setResults] = useState<SearchResult[]>(initialResults);
  const [hasSearched, setHasSearched] = useState(initialQuery.trim() !== '');

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const performSearch = useCallback(async (q: string, c?: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    setHasSearched(true);
    const params = new URLSearchParams();
    params.set('q', trimmed);
    if (c) params.set('c', c);

    try {
      const res = await fetch(`/search.json?${params.toString()}`);
      if (!res.ok) return;
      const data = (await res.json()) as { results: SearchResult[] };
      setResults(data.results ?? []);
    } catch {
      // Keep previous results on network error
    }
  }, []);

  const handleQueryChange = (newQuery: string) => {
    setQuery(newQuery);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void performSearch(newQuery, category);
      if (typeof window !== 'undefined') {
        const href = searchHref(newQuery, category);
        window.history.replaceState(null, '', href);
      }
    }, 150);
  };

  const handleCategoryClick = (catSlug?: string) => {
    setCategory(catSlug);
    if (timerRef.current) clearTimeout(timerRef.current);
    void performSearch(query, catSlug);
    if (typeof window !== 'undefined') {
      const href = searchHref(query, catSlug);
      window.history.replaceState(null, '', href);
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="tenant-search-layout tenant-two-col">
      <aside className="tenant-search-sidebar" aria-label="Filter by category">
        <h4 className="tenant-search-sidebar-heading">Filter by category</h4>
        <nav className="tenant-search-sidebar-nav">
          <Link
            href={searchHref(query)}
            className={`tenant-search-sidebar-item${!category ? ' active' : ''}`}
            aria-current={!category ? 'true' : undefined}
            onClick={(e) => {
              e.preventDefault();
              handleCategoryClick(undefined);
            }}
          >
            <span>All guides</span>
            <span className="tenant-search-sidebar-count">{totalGuides}</span>
          </Link>
          {counts.map((cat) => (
            <Link
              key={cat.slug}
              href={searchHref(query, cat.slug)}
              className={`tenant-search-sidebar-item${category === cat.slug ? ' active' : ''}`}
              aria-current={category === cat.slug ? 'true' : undefined}
              onClick={(e) => {
                e.preventDefault();
                handleCategoryClick(cat.slug);
              }}
            >
              <span>{cat.name}</span>
              <span className="tenant-search-sidebar-count">{cat.count}</span>
            </Link>
          ))}
        </nav>
      </aside>

      <div className="tenant-search-main">
        <form
          className="tenant-search-page-form"
          action="/search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (typeof window !== 'undefined') {
              window.location.href = searchHref(query, category);
            }
          }}
        >
          <div className="tenant-search-page-input-wrap">
            <svg
              className="tenant-search-page-icon"
              width="18"
              height="18"
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
              value={query}
              placeholder="Search guides"
              autoComplete="off"
              className="tenant-search-page-input"
              onChange={(e) => handleQueryChange(e.target.value)}
            />
            {category && <input type="hidden" name="c" value={category} />}
          </div>
        </form>

        {hasSearched && query.trim() !== '' && results.length > 0 && (
          <p className="tenant-search-count muted">
            {results.length} result{results.length === 1 ? '' : 's'} for “{query.trim()}”
          </p>
        )}

        {hasSearched && query.trim() !== '' && results.length === 0 ? (
          <div className="tenant-search-empty-card">
            <p className="tenant-search-empty-title">No guides match “{query.trim()}”</p>
            <p className="tenant-search-empty-sub muted">Try fewer words, or browse a category.</p>
            <div className="tenant-search-empty-categories">
              {(emptyCategories && emptyCategories.length > 0 ? emptyCategories : counts).map((cat) => (
                <Link
                  key={cat.slug}
                  href={searchHref(query, cat.slug)}
                  className="tenant-search-empty-cat-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    handleCategoryClick(cat.slug);
                  }}
                >
                  {cat.name}
                </Link>
              ))}
            </div>
            {category && (
              <p className="tenant-search-clear-wrap">
                <button
                  type="button"
                  className="tenant-search-clear-btn"
                  onClick={() => handleCategoryClick(undefined)}
                >
                  Clear category filter
                </button>
              </p>
            )}
          </div>
        ) : (
          <ul className="tenant-search-result-list">
            {results.map((result) => (
              <li key={result.slug} className="card tenant-search-card">
                <h3 className="tenant-search-card-title">
                  <Link href={`/g/${encodeURIComponent(result.slug)}`}>
                    <HighlightText text={result.title} query={query} />
                  </Link>
                </h3>
                <p className="tenant-search-card-meta">
                  {result.category && (
                    <>
                      <span className="tenant-search-card-category">
                        <HighlightText text={result.category.name} query={query} />
                      </span>
                      {' · '}
                    </>
                  )}
                  <span className="tenant-search-card-summary">
                    <HighlightText text={result.summary || result.snippet} query={query} />
                  </span>
                </p>
              </li>
            ))}
          </ul>
        )}

        <div className="tenant-stuck-card">
          <p className="tenant-stuck-text">
            Still stuck? Ask the assistant. It answers from these guides and links the steps.
          </p>
          <a
            href="#ask-ai"
            className="tenant-ask-ai-pill"
            onClick={(e) => {
              e.preventDefault();
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('open-ask-ai', { detail: { query } }));
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
            Ask AI
          </a>
        </div>
      </div>
    </div>
  );
}
