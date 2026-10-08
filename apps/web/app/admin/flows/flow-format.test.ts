import { describe, expect, test } from 'bun:test';

import { docLinkFor, flagsNotRedacted, formatFlowDate, formatRecordedDate } from './flow-format';

describe('formatFlowDate', () => {
  test("formats a compiled run's date", () => {
    expect(formatFlowDate('2026-09-28T12:00:00.000Z')).toBe('Sep 28');
  });
});

describe('formatRecordedDate', () => {
  test('formats a recorded run date into Sep 30, 2026 format', () => {
    expect(formatRecordedDate('2026-09-30T10:00:00.000Z')).toBe('Sep 30, 2026');
  });

  test('returns empty string for missing or invalid dates', () => {
    expect(formatRecordedDate(null)).toBe('');
    expect(formatRecordedDate(undefined)).toBe('');
    expect(formatRecordedDate('invalid-date')).toBe('');
  });
});

describe('flagsNotRedacted', () => {
  test('flags Not redacted when any step mode is off', () => {
    expect(flagsNotRedacted({ not_redacted: true })).toBe(true);
    expect(flagsNotRedacted({ not_redacted: false })).toBe(false);
  });
});

describe('docLinkFor', () => {
  test('returns no doc link when url is null', () => {
    expect(docLinkFor({ url: null })).toBeNull();
    expect(docLinkFor({ url: 'https://example.com/d/abc' })).toBe('https://example.com/d/abc');
  });
});

test('never links a non-http url', () => {
  expect(docLinkFor({ url: 'javascript:alert(1)' })).toBeNull();
  expect(docLinkFor({ url: 'data:text/html,x' })).toBeNull();
  expect(docLinkFor({ url: 'https://opendocs.example/d/abc' })).toBe('https://opendocs.example/d/abc');
});
