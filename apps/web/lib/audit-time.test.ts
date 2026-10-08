import { describe, expect, test } from 'bun:test';
import { formatAuditTime, formatLastActive } from './audit-time';

describe('formatAuditTime', () => {
  const baseNow = new Date('2026-10-04T12:00:00Z');

  test('formats today timestamp as Today HH:mm', () => {
    const today = new Date(baseNow);
    today.setHours(14, 2);
    expect(formatAuditTime(today, baseNow)).toBe('Today 14:02');
  });

  test('formats yesterday timestamp as Yesterday HH:mm', () => {
    const yesterday = new Date(baseNow);
    yesterday.setDate(baseNow.getDate() - 1);
    yesterday.setHours(16, 31);
    expect(formatAuditTime(yesterday, baseNow)).toBe('Yesterday 16:31');
  });

  test('formats earlier date in same year as Mon DD HH:mm', () => {
    const past = new Date(baseNow.getFullYear(), 8, 28, 15, 12); // Sep 28
    expect(formatAuditTime(past, baseNow)).toBe('Sep 28 15:12');
  });

  test('handles invalid date', () => {
    expect(formatAuditTime('invalid')).toBe('unknown');
  });
});

describe('formatLastActive', () => {
  const baseNow = new Date('2026-10-04T12:00:00Z');

  test('formats today as Today', () => {
    const today = new Date(baseNow);
    today.setHours(8, 0);
    expect(formatLastActive(today, baseNow)).toBe('Today');
  });

  test('formats days ago relatively', () => {
    const threeDaysAgo = new Date(baseNow);
    threeDaysAgo.setDate(baseNow.getDate() - 3);
    expect(formatLastActive(threeDaysAgo, baseNow)).toBe('3 days ago');
  });

  test('handles null/undefined as Never', () => {
    expect(formatLastActive(null)).toBe('Never');
    expect(formatLastActive(undefined)).toBe('Never');
  });
});
