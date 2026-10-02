import { expect, test } from 'bun:test';
import { mapPageUrl, parseUrlMap } from './url-map';

/** The exact example string documented in the README's "Recording on staging" block. */
export const README_URL_MAP_EXAMPLE = 'pfnapp.my.id=pfnapp.id';

test('swaps host and keeps path, query, hash', () => {
  const map = parseUrlMap({ OPENDOCS_URL_MAP: 'pfnapp.my.id=pfnapp.id' });
  const result = mapPageUrl('https://pfnapp.my.id/id/console/whatsapp/templates/new?tab=1#top', map);
  expect(result).toEqual({
    url: 'https://pfnapp.id/id/console/whatsapp/templates/new?tab=1#top',
    rewritten: true,
  });
});

test('to with scheme replaces scheme', () => {
  const map = parseUrlMap({ OPENDOCS_URL_MAP: 'localhost:3000=https://pfnapp.id' });
  const result = mapPageUrl('http://localhost:3000/login', map);
  expect(result).toEqual({ url: 'https://pfnapp.id/login', rewritten: true });
});

test('exact case-insensitive match only', () => {
  const map = parseUrlMap({ OPENDOCS_URL_MAP: 'a.example=x.com,b.example=y.com' });

  expect(mapPageUrl('https://A.EXAMPLE/path', map)).toEqual({
    url: 'https://x.com/path',
    rewritten: true,
  });
  expect(mapPageUrl('https://b.example/other', map)).toEqual({
    url: 'https://y.com/other',
    rewritten: true,
  });
  // Subdomains are not matched implicitly.
  expect(mapPageUrl('https://sub.a.example/path', map)).toEqual({
    url: 'https://sub.a.example/path',
    rewritten: false,
  });
});

test('unchanged when no match or no map', () => {
  const map = parseUrlMap({ OPENDOCS_URL_MAP: 'a.example=x.com' });
  expect(mapPageUrl('https://other.example/path', map)).toEqual({
    url: 'https://other.example/path',
    rewritten: false,
  });

  const emptyMap = parseUrlMap({});
  expect(mapPageUrl('https://a.example/path', emptyMap)).toEqual({
    url: 'https://a.example/path',
    rewritten: false,
  });
});

test('malformed url unchanged', () => {
  const map = parseUrlMap({ OPENDOCS_URL_MAP: 'a.example=x.com' });
  expect(mapPageUrl('not a url', map)).toEqual({ url: 'not a url', rewritten: false });
});

test('invalid entries skipped and reported', () => {
  const warnings: string[] = [];
  const map = parseUrlMap({ OPENDOCS_URL_MAP: 'broken,=x,y=,a.example=x.com' }, (line) => warnings.push(line));

  expect(warnings).toEqual([
    'OPENDOCS_URL_MAP: skipping invalid entry "broken"\n',
    'OPENDOCS_URL_MAP: skipping invalid entry "=x"\n',
    'OPENDOCS_URL_MAP: skipping invalid entry "y="\n',
  ]);
  // The valid entry still applies.
  expect(mapPageUrl('https://a.example/path', map)).toEqual({
    url: 'https://x.com/path',
    rewritten: true,
  });
});

test('drops url credentials', () => {
  const map = parseUrlMap({ OPENDOCS_URL_MAP: 'host.example=pfnapp.id' });
  const result = mapPageUrl('https://user:pw@host.example/path', map);
  expect(result).toEqual({ url: 'https://pfnapp.id/path', rewritten: true });
});

test('readme example parses', () => {
  const map = parseUrlMap({ OPENDOCS_URL_MAP: README_URL_MAP_EXAMPLE });
  const result = mapPageUrl('https://pfnapp.my.id/login', map);
  expect(result).toEqual({ url: 'https://pfnapp.id/login', rewritten: true });
});
