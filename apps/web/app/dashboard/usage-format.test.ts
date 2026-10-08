import { describe, expect, test } from 'bun:test';

import {
  formatAiCreditsUsage,
  formatBytesUsage,
  formatFilesUsage,
  formatStorageUsage,
  usagePercent,
} from './usage-format';

describe('formatFilesUsage', () => {
  test('formats files used/limit', () => {
    expect(formatFilesUsage(180, 200)).toBe('20 / 200 files');
  });

  test('formats large numbers with thousands separators', () => {
    expect(formatFilesUsage(10000, 10000)).toBe('0 / 10,000 files');
    expect(formatFilesUsage(0, 10000)).toBe('10,000 / 10,000 files');
  });
});

describe('formatBytesUsage', () => {
  test('formats bytes with MB/GB thresholds', () => {
    const MB = 1024 * 1024;
    const GB = 1024 * MB;

    expect(formatBytesUsage(200 * MB - 45 * MB, 200 * MB)).toBe('45 MB / 200 MB');
    expect(formatBytesUsage(2 * GB - 1.2 * GB, 2 * GB)).toBe('1.2 GB / 2.0 GB');
  });
});

describe('usagePercent', () => {
  test('clamps percentage at 100 when used exceeds limit', () => {
    expect(usagePercent(-50, 200)).toBe(100);
  });
});

describe('formatStorageUsage', () => {
  test('formats storage with of wording and plan caption for Free', () => {
    expect(formatStorageUsage(62, 100, 'OpenDocs storage', 'free')).toBe(
      '62 of 100 MiB on OpenDocs storage (Free)',
    );
  });

  test('formats storage with thousands separators and custom destination for Enterprise', () => {
    expect(formatStorageUsage(0, 10000, 'own Drive or S3', 'enterprise')).toBe(
      '0 of 10,000 MiB on own Drive or S3 (Enterprise)',
    );
  });

  test('formats storage for Pro plan with own Google Drive', () => {
    expect(formatStorageUsage(150, 1000, 'own Google Drive', 'pro')).toBe(
      '150 of 1,000 MiB on own Google Drive (Pro)',
    );
  });
});

describe('formatAiCreditsUsage', () => {
  test('formats AI credits with of wording, thousands separators and 1 credit note', () => {
    expect(formatAiCreditsUsage(412, 10000)).toBe(
      '412 of 10,000 credits (1 credit = 1 reply)',
    );
  });

  test('formats zero usage and small limits correctly', () => {
    expect(formatAiCreditsUsage(0, 1000)).toBe(
      '0 of 1,000 credits (1 credit = 1 reply)',
    );
    expect(formatAiCreditsUsage(0, 0)).toBe(
      '0 of 0 credits (1 credit = 1 reply)',
    );
  });
});

