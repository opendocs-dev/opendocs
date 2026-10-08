type HeaderGetter = { get(name: string): string | null };

/** Absolute origin for the current tenant request, built from forwarded headers. */
export function siteOrigin(headers: HeaderGetter): string {
  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? '';
  const proto = headers.get('x-forwarded-proto') === 'http' ? 'http' : 'https';
  return `${proto}://${host}`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export type SitemapGuide = { slug: string; updated_at: string; noindex?: boolean };

export type SitemapCategory = { slug: string };

/** Sitemap for a tenant site: the home page, one `<url>` per category, and one per published guide. Empty urlset when `indexing` is off (AC-15: pages are noindex and robots.txt blocks them, so the sitemap must list nothing, including home). */
export function buildSitemap(
  origin: string,
  guides: SitemapGuide[],
  categories: SitemapCategory[] = [],
  indexing = true,
): string {
  const urls: string[] = [];
  if (indexing) {
    urls.push(`<url><loc>${escapeXml(`${origin}/`)}</loc></url>`);
    for (const category of categories) {
      const loc = escapeXml(`${origin}/c/${encodeURIComponent(category.slug)}`);
      urls.push(`<url><loc>${loc}</loc></url>`);
    }
    for (const guide of guides) {
      if (guide.noindex) continue;
      const loc = escapeXml(`${origin}/g/${encodeURIComponent(guide.slug)}`);
      const lastmod = new Date(guide.updated_at).toISOString();
      urls.push(`<url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>`);
    }
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
  ].join('\n');
}

/** robots.txt for a tenant site: fully blocked when site indexing is off, else allowed minus /search. */
export function buildRobots(origin: string, indexing: boolean): string {
  if (!indexing) return 'User-agent: *\nDisallow: /';
  return `User-agent: *\nAllow: /\nDisallow: /search\nSitemap: ${origin}/sitemap.xml`;
}

/** Search page href with query and optional category filter. */
export function searchHref(q: string, category?: string): string {
  const params = new URLSearchParams();
  if (q.trim()) {
    params.set('q', q);
  }
  if (category !== undefined) {
    params.set('c', category);
  }
  const str = params.toString();
  return str ? `/search?${str}` : '/search';
}

/** Formats ISO date string to short date, e.g. "Sep 30" (Contract UI-R1/UI-R3). */
export function formatGuideDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  } catch {
    return '';
  }
}

/** Formats ISO date string to full date, e.g. "Sep 30, 2026" (Finding 4). */
export function formatGuideFullDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  } catch {
    return '';
  }
}

export type HighlightPart = { text: string; mark: boolean };

/**
 * Splits text into marked and unmarked parts based on query words (case-insensitive).
 */
export function highlightWords(text: string, query: string): HighlightPart[] {
  const trimmed = query.trim();
  if (!trimmed || !text) return [{ text, mark: false }];

  const words = trimmed
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  if (words.length === 0) return [{ text, mark: false }];

  const wordPattern = words.map((w) => `${w}[\\p{L}\\p{N}]*`).join('|');
  const splitRegex = new RegExp(`(?<=[^\\p{L}\\p{N}]|^)(${wordPattern})(?=[^\\p{L}\\p{N}]|$)`, 'giu');
  const matchRegex = new RegExp(`^(${wordPattern})$`, 'iu');
  const rawParts = text.split(splitRegex);
  return rawParts.filter(Boolean).map((part) => ({
    text: part,
    mark: matchRegex.test(part),
  }));
}

export type SnippetPart = { text: string; mark: boolean };

const MARKER_PATTERN = /\[\[(.*?)\]\]/g;

/** Strips markdown syntax (bold, italic, code) from a snippet string. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/`/g, '');
}

/**
 * Splits an API search snippet (marked with `[[`/`]]` around matched terms) into plain
 * text parts, so the caller can render `<mark>` elements without ever using raw HTML.
 * Strips raw markdown syntax before parsing markers.
 */
export function snippetParts(snippet: string): SnippetPart[] {
  const cleaned = stripMarkdown(snippet);
  const parts: SnippetPart[] = [];
  let lastIndex = 0;

  for (const match of cleaned.matchAll(MARKER_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push({ text: cleaned.slice(lastIndex, index), mark: false });
    parts.push({ text: match[1] ?? '', mark: true });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < cleaned.length) parts.push({ text: cleaned.slice(lastIndex), mark: false });

  return parts;
}
