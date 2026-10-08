import { describe, expect, test } from 'bun:test';
import {
  buildRobots,
  buildSitemap,
  formatGuideDate,
  formatGuideFullDate,
  highlightWords,
  searchHref,
  snippetParts,
  stripMarkdown,
  tenantOrigin,
} from './tenant-url';

const headerMap = (entries: Record<string, string>) => ({
  get: (key: string) => entries[key] ?? null,
});

describe('tenantOrigin', () => {
  test('prefers x-forwarded-host over host', () => {
    const headers = headerMap({ 'x-forwarded-host': 'acme.opendocs.test', host: 'internal:4000' });
    expect(tenantOrigin(headers)).toBe('https://acme.opendocs.test');
  });

  test('falls back to host when x-forwarded-host is absent', () => {
    const headers = headerMap({ host: 'acme.opendocs.test' });
    expect(tenantOrigin(headers)).toBe('https://acme.opendocs.test');
  });

  test('uses http only when x-forwarded-proto is exactly http', () => {
    const headers = headerMap({ host: 'acme.opendocs.test', 'x-forwarded-proto': 'http' });
    expect(tenantOrigin(headers)).toBe('http://acme.opendocs.test');
  });

  test('defaults to https when x-forwarded-proto is missing or anything else', () => {
    expect(tenantOrigin(headerMap({ host: 'acme.opendocs.test' }))).toBe('https://acme.opendocs.test');
    expect(tenantOrigin(headerMap({ host: 'acme.opendocs.test', 'x-forwarded-proto': 'https' }))).toBe(
      'https://acme.opendocs.test',
    );
  });

  test('returns an empty host when neither header is present', () => {
    expect(tenantOrigin(headerMap({}))).toBe('https://');
  });
});

describe('snippetParts', () => {
  test('splits marked and unmarked runs', () => {
    expect(snippetParts('[[a]] b [[c]]')).toEqual([
      { text: 'a', mark: true },
      { text: ' b ', mark: false },
      { text: 'c', mark: true },
    ]);
  });

  test('a snippet with no markers is a single unmarked part', () => {
    expect(snippetParts('plain text')).toEqual([{ text: 'plain text', mark: false }]);
  });

  test('an empty snippet produces no parts', () => {
    expect(snippetParts('')).toEqual([]);
  });

  test('text containing a script tag stays plain, unmarked text', () => {
    const parts = snippetParts('before [[<script>alert(1)</script>]] after');
    expect(parts).toEqual([
      { text: 'before ', mark: false },
      { text: '<script>alert(1)</script>', mark: true },
      { text: ' after', mark: false },
    ]);
    expect(parts.every((part) => typeof part.text === 'string')).toBe(true);
  });

  test('strips raw markdown bold and code formatting while preserving search markers', () => {
    expect(snippetParts('Click `**Templates**` in the left sidebar.')).toEqual([
      { text: 'Click Templates in the left sidebar.', mark: false },
    ]);
    expect(snippetParts('Click **[[Templates]]** in the `left sidebar`')).toEqual([
      { text: 'Click ', mark: false },
      { text: 'Templates', mark: true },
      { text: ' in the left sidebar', mark: false },
    ]);
    expect(stripMarkdown('Click `**Templates**` in the left sidebar.')).toBe(
      'Click Templates in the left sidebar.',
    );
  });
});

describe('buildSitemap', () => {
  test('includes the home page and one url per guide with an ISO lastmod', () => {
    const xml = buildSitemap('https://acme.opendocs.test', [
      { slug: 'first-guide', updated_at: '2026-01-02T03:04:05.000Z' },
    ]);

    expect(xml).toContain('<loc>https://acme.opendocs.test/</loc>');
    expect(xml).toContain('<loc>https://acme.opendocs.test/g/first-guide</loc>');
    expect(xml).toContain('<lastmod>2026-01-02T03:04:05.000Z</lastmod>');
  });

  test('escapes & in urls and slugs', () => {
    const xml = buildSitemap('https://acme.opendocs.test', [
      { slug: 'a&b', updated_at: '2026-01-02T03:04:05.000Z' },
    ]);

    expect(xml).not.toContain('a&b');
    expect(xml).toContain('a%26b');
  });

  test('produces just the home url when there are no guides', () => {
    const xml = buildSitemap('https://acme.opendocs.test', []);
    expect(xml).toContain('<loc>https://acme.opendocs.test/</loc>');
    expect(xml.match(/<url>/g)).toHaveLength(1);
  });

  test('excludes a guide marked noindex, keeping the home url and other guides', () => {
    const xml = buildSitemap('https://acme.opendocs.test', [
      { slug: 'visible-guide', updated_at: '2026-01-02T03:04:05.000Z' },
      { slug: 'hidden-guide', updated_at: '2026-01-02T03:04:05.000Z', noindex: true },
    ]);

    expect(xml).toContain('<loc>https://acme.opendocs.test/</loc>');
    expect(xml).toContain('<loc>https://acme.opendocs.test/g/visible-guide</loc>');
    expect(xml).not.toContain('hidden-guide');
  });

  test('includes category urls before guide urls', () => {
    const xml = buildSitemap('https://acme.opendocs.test', [
      { slug: 'guide-1', updated_at: '2026-01-02T03:04:05.000Z' },
    ], [
      { slug: 'getting-started' },
    ]);

    const homeIndex = xml.indexOf('https://acme.opendocs.test/</loc>');
    const categoryIndex = xml.indexOf('https://acme.opendocs.test/c/getting-started</loc>');
    const guideIndex = xml.indexOf('https://acme.opendocs.test/g/guide-1</loc>');

    expect(homeIndex).toBeLessThan(categoryIndex);
    expect(categoryIndex).toBeLessThan(guideIndex);
  });

  test('escapes & in category slugs', () => {
    const xml = buildSitemap('https://acme.opendocs.test', [], [
      { slug: 'a&b' },
    ]);

    expect(xml).not.toContain('a&b');
    expect(xml).toContain('c/a%26b</loc>');
  });

  test('handles empty categories list by default', () => {
    const xml = buildSitemap('https://acme.opendocs.test', []);
    expect(xml.match(/<url>/g)).toHaveLength(1);
  });

  test('is empty when indexing is off, even with guides and categories', () => {
    const xml = buildSitemap(
      'https://acme.opendocs.test',
      [{ slug: 'guide-1', updated_at: '2026-01-02T03:04:05.000Z' }],
      [{ slug: 'getting-started' }],
      false,
    );

    expect(xml).not.toContain('<loc>');
    expect(xml.match(/<url>/g)).toBeNull();
  });
});

describe('buildRobots', () => {
  test('disallows everything when indexing is off', () => {
    expect(buildRobots('https://acme.opendocs.test', false)).toBe('User-agent: *\nDisallow: /');
  });

  test('allows the site but blocks /search and points to the sitemap when indexing is on', () => {
    expect(buildRobots('https://acme.opendocs.test', true)).toBe(
      'User-agent: *\nAllow: /\nDisallow: /search\nSitemap: https://acme.opendocs.test/sitemap.xml',
    );
  });
});

describe('searchHref', () => {
  test('returns search url with query only', () => {
    expect(searchHref('my query')).toBe('/search?q=my+query');
  });

  test('includes category filter when provided', () => {
    expect(searchHref('my query', 'getting-started')).toBe('/search?q=my+query&c=getting-started');
  });

  test('URL-encodes special characters in query', () => {
    expect(searchHref('a & b')).toBe('/search?q=a+%26+b');
  });

  test('URL-encodes special characters in category', () => {
    expect(searchHref('test', 'a & b')).toBe('/search?q=test&c=a+%26+b');
  });

  test('returns /search when both query and category are empty', () => {
    expect(searchHref('')).toBe('/search');
    expect(searchHref('   ')).toBe('/search');
  });
});

describe('formatGuideDate', () => {
  test('formats ISO date to short date like "Sep 30"', () => {
    expect(formatGuideDate('2026-09-30T14:00:00.000Z')).toBe('Sep 30');
    expect(formatGuideDate('2026-01-05T00:00:00.000Z')).toBe('Jan 5');
  });

  test('returns empty string for invalid date', () => {
    expect(formatGuideDate('invalid-date')).toBe('');
    expect(formatGuideDate('')).toBe('');
  });
});

describe('formatGuideFullDate', () => {
  test('formats ISO date to full date like "Sep 30, 2026"', () => {
    expect(formatGuideFullDate('2026-09-30T14:00:00.000Z')).toBe('Sep 30, 2026');
    expect(formatGuideFullDate('2026-01-05T00:00:00.000Z')).toBe('Jan 5, 2026');
  });

  test('returns empty string for invalid date', () => {
    expect(formatGuideFullDate('invalid-date')).toBe('');
    expect(formatGuideFullDate('')).toBe('');
  });
});

describe('highlightWords', () => {
  test('marks matched terms case-insensitively', () => {
    const parts = highlightWords('How to Create Templates', 'template');
    expect(parts).toEqual([
      { text: 'How to Create ', mark: false },
      { text: 'Templates', mark: true },
    ]);
  });

  test('marks multiple matching words in query', () => {
    const parts = highlightWords('Open WhatsApp Templates in dashboard', 'whatsapp template');
    expect(parts).toEqual([
      { text: 'Open ', mark: false },
      { text: 'WhatsApp', mark: true },
      { text: ' ', mark: false },
      { text: 'Templates', mark: true },
      { text: ' in dashboard', mark: false },
    ]);
  });

  test('returns full text unmarked when query is empty or whitespace', () => {
    expect(highlightWords('WhatsApp Guides', '')).toEqual([{ text: 'WhatsApp Guides', mark: false }]);
    expect(highlightWords('WhatsApp Guides', '   ')).toEqual([{ text: 'WhatsApp Guides', mark: false }]);
  });

  test('returns full text unmarked when no words match', () => {
    expect(highlightWords('WhatsApp Guides', 'zzzz')).toEqual([{ text: 'WhatsApp Guides', mark: false }]);
  });
});
