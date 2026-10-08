import { describe, expect, test } from 'bun:test';
import { parseTenantHost, tenantRewritePath } from './tenant-host';

describe('parseTenantHost', () => {
  test('extracts the label from a tenant host', () => {
    expect(parseTenantHost('acme.opendocs.test', 'opendocs.test')).toBe('acme');
  });

  test('strips the port before matching', () => {
    expect(parseTenantHost('acme.opendocs.test:3000', 'opendocs.test')).toBe('acme');
  });

  test('is case-insensitive', () => {
    expect(parseTenantHost('ACME.OpenDocs.Test', 'opendocs.test')).toBe('acme');
  });

  test('returns null for the apex domain itself', () => {
    expect(parseTenantHost('opendocs.test', 'opendocs.test')).toBeNull();
  });

  test('returns null for a nested label', () => {
    expect(parseTenantHost('a.b.opendocs.test', 'opendocs.test')).toBeNull();
  });

  test('returns null when the base domain is unset', () => {
    expect(parseTenantHost('acme.opendocs.test', undefined)).toBeNull();
    expect(parseTenantHost('acme.opendocs.test', '')).toBeNull();
  });

  test('returns null for an unrelated host', () => {
    expect(parseTenantHost('example.com', 'opendocs.test')).toBeNull();
  });
});

describe('tenantRewritePath', () => {
  test('rewrites the home path', () => {
    expect(tenantRewritePath('acme', '/')).toBe('/tenant/acme');
  });

  test('rewrites a nested path', () => {
    expect(tenantRewritePath('acme', '/g/setup')).toBe('/tenant/acme/g/setup');
  });
});
