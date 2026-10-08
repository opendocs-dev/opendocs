import { describe, expect, test } from 'bun:test';

import { formatKeyLastUsed, maskKey } from './key-mask';

describe('maskKey', () => {
  test('masks using the stored start', () => {
    expect(maskKey('od_live_abcd')).toBe('od_live_abcd···');
  });

  test('returns a placeholder when start is missing', () => {
    expect(maskKey(null)).toBe('••••••');
    expect(maskKey(undefined)).toBe('••••••');
    expect(maskKey('')).toBe('••••••');
  });
});

describe('formatKeyLastUsed', () => {
  test('returns Not connected yet when date is missing', () => {
    expect(formatKeyLastUsed(null)).toBe('Not connected yet');
    expect(formatKeyLastUsed(undefined)).toBe('Not connected yet');
    expect(formatKeyLastUsed('')).toBe('Not connected yet');
  });

  test('returns Today when date matches today', () => {
    const now = new Date('2026-10-04T12:00:00Z');
    expect(formatKeyLastUsed('2026-10-04T08:30:00Z', now)).toBe('Today');
  });

  test('returns formatted month and day when earlier date', () => {
    const now = new Date('2026-10-04T12:00:00Z');
    expect(formatKeyLastUsed('2026-09-24T10:00:00Z', now)).toBe('Sep 24');
  });

  test('returns unknown for invalid date string', () => {
    expect(formatKeyLastUsed('not-a-date')).toBe('unknown');
  });
});

test("formatKeyLastUsed is timezone-stable (UTC), so server and browser render the same text", () => {
  const now = new Date("2026-10-04T23:30:00Z");
  expect(formatKeyLastUsed("2026-10-04T00:10:00Z", now)).toBe("Today");
  expect(formatKeyLastUsed("2026-10-03T23:59:00Z", now)).toBe("Oct 3");
});
