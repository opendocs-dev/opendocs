'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { SearchResult } from '@/lib/tenant-api';
import { snippetParts } from '@/lib/tenant-url';

const DEBOUNCE_MS = 150;

function Snippet({ text }: { text: string }) {
  return (
    <span className="tenant-search-snippet">
      {snippetParts(text).map((part, index) =>
        part.mark ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
      )}
    </span>
  );
}

function HighlightText({ text, query }: { text: string; query: string }) {
  const trimmed = query.trim();
  if (!trimmed) return <>{text}</>;

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, index) =>
        regex.test(part) ? (
          <mark key={index} className="tenant-search-highlight">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function SearchBox({ guideCount }: { guideCount?: number } = {}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (q: string) => {
    if (q.trim() === '') {
      setResults(null);
      return;
    }
    const response = await fetch(`/search.json?q=${encodeURIComponent(q)}`);
    if (!response.ok) {
      setResults(null);
      return;
    }
    const body = (await response.json()) as { results: SearchResult[] };
    setResults(body.results);
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void runSearch(query);
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, runSearch]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  function handleKeyDownOnInput(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Escape') return;
    setQuery('');
    setResults(null);
    setOpen(false);
  }

  const showResults = open && results !== null;
  const placeholder =
    guideCount !== undefined && guideCount > 0
      ? `Search ${guideCount} guides, try “template”`
      : 'Search guides, try “template”';

  return (
    <div className="tenant-search">
      <form className="tenant-search-form" action="/search" role="search">
        <div className="tenant-search-input-wrap">
          <svg
            className="tenant-search-icon"
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
            ref={inputRef}
            type="text"
            name="q"
            role="combobox"
            aria-expanded={showResults}
            aria-controls="tenant-search-listbox"
            autoComplete="off"
            placeholder={placeholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDownOnInput}
          />
          {!query && <kbd className="tenant-search-kbd">Ctrl K</kbd>}
        </div>
        <button type="submit">Search</button>
      </form>
      {showResults && (
        <div id="tenant-search-listbox" className="tenant-search-results" role="listbox">
          {results!.length === 0 ? (
            <div className="tenant-search-empty">
              <p className="tenant-search-empty-title">No guides match “{query}”</p>
              <p className="tenant-search-empty-sub muted">Try fewer words, or browse the categories below.</p>
            </div>
          ) : (
            <ul>
              {results!.slice(0, 5).map((result) => {
                const metaParts: string[] = [];
                if (result.category?.name) metaParts.push(result.category.name);
                if (typeof result.steps === 'number') {
                  metaParts.push(`${result.steps} step${result.steps === 1 ? '' : 's'}`);
                }
                const metaText = metaParts.join(' · ');

                return (
                  <li key={result.slug} role="option" aria-selected="false">
                    <a href={`/g/${encodeURIComponent(result.slug)}`}>
                      <span className="tenant-search-title">
                        <HighlightText text={result.title} query={query} />
                      </span>
                      {metaText ? (
                        <span className="tenant-search-meta muted">{metaText}</span>
                      ) : (
                        <Snippet text={result.snippet} />
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
