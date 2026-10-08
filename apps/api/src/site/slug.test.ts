import { expect, test } from 'bun:test';
import { validateSlug } from './slug';

test('accepts a hyphenated slug', () => {
  expect(validateSlug('a-b')).toEqual({ ok: true, slug: 'a-b' });
});

test('accepts a short valid slug', () => {
  expect(validateSlug('abc')).toEqual({ ok: true, slug: 'abc' });
});

test('accepts a 30-char slug', () => {
  const slug = 'a'.repeat(30);
  expect(validateSlug(slug)).toEqual({ ok: true, slug });
});

test('rejects a 2-char slug', () => {
  expect(validateSlug('ab').ok).toBe(false);
});

test('rejects a 31-char slug', () => {
  expect(validateSlug('a'.repeat(31)).ok).toBe(false);
});

test('rejects a leading hyphen', () => {
  expect(validateSlug('-abc').ok).toBe(false);
});

test('rejects a trailing hyphen', () => {
  expect(validateSlug('abc-').ok).toBe(false);
});

test('rejects a doubled hyphen', () => {
  expect(validateSlug('a--b').ok).toBe(false);
});

test('rejects an exclamation mark', () => {
  expect(validateSlug('ABC!').ok).toBe(false);
});

test('rejects a non-ASCII character', () => {
  expect(validateSlug('é').ok).toBe(false);
});

test('lowercases the stored and returned slug', () => {
  expect(validateSlug('ABC')).toEqual({ ok: true, slug: 'abc' });
});
