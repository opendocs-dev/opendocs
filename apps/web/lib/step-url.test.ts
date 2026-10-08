import { describe, expect, test } from 'bun:test';

import { hostFromPageUrl, pathFromPageUrl } from './step-url';

describe('hostFromPageUrl', () => {
  test('extracts the host from a full URL', () => {
    expect(hostFromPageUrl('https://acme.my.id/checkout?step=2')).toBe('acme.my.id');
  });

  test('extracts the host including a port', () => {
    expect(hostFromPageUrl('http://localhost:3000/app')).toBe('localhost:3000');
  });

  test('falls back to a best-effort strip for a malformed URL', () => {
    expect(hostFromPageUrl('not a url/path')).toBe('not a url');
  });

  test('returns an empty string when page_url is missing', () => {
    expect(hostFromPageUrl(undefined)).toBe('');
  });
});

describe('pathFromPageUrl', () => {
  test('strips the scheme, keeping host and path', () => {
    expect(pathFromPageUrl('https://acme.my.id/checkout?step=2')).toBe('acme.my.id/checkout?step=2');
  });

  test('leaves a schemeless value untouched', () => {
    expect(pathFromPageUrl('acme.my.id/checkout')).toBe('acme.my.id/checkout');
  });

  test('returns an empty string when page_url is missing', () => {
    expect(pathFromPageUrl(undefined)).toBe('');
  });
});
