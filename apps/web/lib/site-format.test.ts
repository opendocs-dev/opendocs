import { describe, expect, test } from 'bun:test';
import { formatStorageGiB, formatTenantDate } from './site-format';

describe('formatStorageGiB', () => {
  const GiB = 1024 * 1024 * 1024;

  test('formats 0 bytes as 0 GiB', () => {
    expect(formatStorageGiB(0)).toBe('0 GiB');
    expect(formatStorageGiB(-100)).toBe('0 GiB');
  });

  test('formats values matching prototype rows', () => {
    expect(formatStorageGiB(62 * GiB)).toBe('62 GiB');
    expect(formatStorageGiB(8.1 * GiB)).toBe('8.1 GiB');
    expect(formatStorageGiB(1.9 * GiB)).toBe('1.9 GiB');
    expect(formatStorageGiB(0.2 * GiB)).toBe('0.2 GiB');
    expect(formatStorageGiB(0.9 * GiB)).toBe('0.9 GiB');
  });
});

describe('formatTenantDate', () => {
  test('formats ISO dates to Sep 12, 2026 format', () => {
    const formatted = formatTenantDate('2026-09-12T10:00:00Z');
    expect(formatted).toBe('Sep 12, 2026');
  });

  test('handles null or invalid dates gracefully', () => {
    expect(formatTenantDate(null)).toBe('–');
    expect(formatTenantDate('invalid-date')).toBe('–');
  });
});
