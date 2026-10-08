import { expect, test } from 'bun:test';
import { checkCnameMatch, expectedCnameTarget, validateDomain } from './domain';

test('accepts a simple two-label domain', () => {
  expect(validateDomain('example.com')).toEqual({ ok: true, domain: 'example.com' });
});

test('accepts a subdomain', () => {
  expect(validateDomain('docs.example.com')).toEqual({ ok: true, domain: 'docs.example.com' });
});

test('lowercases the stored and returned domain', () => {
  expect(validateDomain('Docs.Example.COM')).toEqual({ ok: true, domain: 'docs.example.com' });
});

test('trims surrounding whitespace', () => {
  expect(validateDomain('  docs.example.com  ')).toEqual({ ok: true, domain: 'docs.example.com' });
});

test('rejects an empty string', () => {
  expect(validateDomain('').ok).toBe(false);
});

test('rejects a single-label host with no dot', () => {
  expect(validateDomain('localhost').ok).toBe(false);
});

test('rejects a leading hyphen label', () => {
  expect(validateDomain('-docs.example.com').ok).toBe(false);
});

test('rejects a trailing hyphen', () => {
  expect(validateDomain('docs.example.com-').ok).toBe(false);
});

test('rejects repeated dots', () => {
  expect(validateDomain('docs..example.com').ok).toBe(false);
});

test('rejects a domain over 253 characters', () => {
  const label = 'a'.repeat(63);
  const domain = `${label}.${label}.${label}.${label}.com`;
  expect(validateDomain(domain).ok).toBe(false);
});

test('rejects a space in the middle', () => {
  expect(validateDomain('docs example.com').ok).toBe(false);
});

test('expectedCnameTarget joins the slug and base domain', () => {
  expect(expectedCnameTarget('acme', 'opendocs.xxx')).toBe('acme.opendocs.xxx');
});

test('checkCnameMatch is true when the resolver returns the expected target', async () => {
  const found = await checkCnameMatch('docs.example.com', 'acme.opendocs.xxx', async () => [
    'acme.opendocs.xxx',
  ]);
  expect(found).toBe(true);
});

test('checkCnameMatch ignores case and a trailing dot from the resolver', async () => {
  const found = await checkCnameMatch('docs.example.com', 'acme.opendocs.xxx', async () => [
    'ACME.OPENDOCS.XXX.',
  ]);
  expect(found).toBe(true);
});

test('checkCnameMatch is false when the resolver returns a different target', async () => {
  const found = await checkCnameMatch('docs.example.com', 'acme.opendocs.xxx', async () => [
    'someone-else.opendocs.xxx',
  ]);
  expect(found).toBe(false);
});

test('checkCnameMatch is false (not thrown) when the resolver rejects (NXDOMAIN, no record, timeout)', async () => {
  const found = await checkCnameMatch('docs.example.com', 'acme.opendocs.xxx', async () => {
    throw new Error('ENODATA');
  });
  expect(found).toBe(false);
});

test('checkCnameMatch is false when the resolver returns an empty list', async () => {
  const found = await checkCnameMatch('docs.example.com', 'acme.opendocs.xxx', async () => []);
  expect(found).toBe(false);
});
