import { describe, expect, test } from 'bun:test';
import {
  CLI_MIN_VERSION,
  DAILY_QUOTAS,
  FREE_DOC_IMAGE_DAYS,
  FREE_STEP_LIMIT,
  FREE_STEPS_PER_RUN,
  GLOBAL_BREAKER_ALERT_BYTES,
  GLOBAL_BREAKER_ALERT_RATIO,
  GLOBAL_BREAKER_BYTES,
  MAX_BYTES,
  MAX_PIXELS,
  PUBLIC_ID_LENGTH,
  SNAP_TTL,
  SNAP_TTL_DEFAULT,
  SNAP_TTL_VALUES,
} from './limits';

describe('limits and constants', () => {
  test('MAX_BYTES equals 10485760', () => {
    expect(MAX_BYTES).toBe(10485760);
    expect(MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  test('FREE_STEPS_PER_RUN equals 15', () => {
    expect(FREE_STEPS_PER_RUN).toBe(15);
    expect(FREE_STEP_LIMIT).toBe(15);
  });

  test('SNAP_TTL default is 24h', () => {
    expect(SNAP_TTL.default).toBe('24h');
    expect(SNAP_TTL_DEFAULT).toBe('24h');
    expect(SNAP_TTL.values).toEqual(['15m', '1h', '24h']);
    expect(SNAP_TTL_VALUES).toEqual(['15m', '1h', '24h']);
    expect(SNAP_TTL.seconds['15m']).toBe(15 * 60);
    expect(SNAP_TTL.seconds['1h']).toBe(60 * 60);
    expect(SNAP_TTL.seconds['24h']).toBe(24 * 60 * 60);
  });

  test('daily quota table matches D4', () => {
    expect(DAILY_QUOTAS.free.files).toBe(200);
    expect(DAILY_QUOTAS.free.bytes).toBe(200 * 1024 * 1024);

    expect(DAILY_QUOTAS.pro.files).toBe(2000);
    expect(DAILY_QUOTAS.pro.bytes).toBe(2 * 1024 * 1024 * 1024);

    expect(DAILY_QUOTAS.team.files).toBe(10000);
    expect(DAILY_QUOTAS.team.bytes).toBe(10 * 1024 * 1024 * 1024);
  });

  test('MAX_PIXELS equals 50000000', () => {
    expect(MAX_PIXELS).toBe(50000000);
  });

  test('FREE_DOC_IMAGE_DAYS equals 30', () => {
    expect(FREE_DOC_IMAGE_DAYS).toBe(30);
  });

  test('GLOBAL_BREAKER_BYTES equals 50 GB with 80% alert threshold', () => {
    expect(GLOBAL_BREAKER_BYTES).toBe(50 * 1024 * 1024 * 1024);
    expect(GLOBAL_BREAKER_ALERT_RATIO).toBe(0.8);
    expect(GLOBAL_BREAKER_ALERT_BYTES).toBe(40 * 1024 * 1024 * 1024);
    expect(GLOBAL_BREAKER_ALERT_BYTES).toBe(GLOBAL_BREAKER_BYTES * 0.8);
  });

  test('PUBLIC_ID_LENGTH equals 16', () => {
    expect(PUBLIC_ID_LENGTH).toBe(16);
  });

  test('CLI_MIN_VERSION is semver format', () => {
    expect(CLI_MIN_VERSION).toBe('0.1.0');
    expect(/^\d+\.\d+\.\d+$/.test(CLI_MIN_VERSION)).toBe(true);
  });
});
