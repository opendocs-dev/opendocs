import { describe, expect, test } from 'bun:test';
import {
  CLI_MIN_VERSION,
  DEFAULT_DRAFT_IMAGE_DAYS,
  DEFAULT_MAX_STEPS_PER_RUN,
  MAX_BYTES,
  MAX_PIXELS,
  PUBLIC_ID_LENGTH,
  SNAP_TTL,
  SNAP_TTL_VALUES,
  STEP_ALT_MAX,
  STEP_TITLE_MAX,
} from './limits';

describe('limits and constants', () => {
  test('MAX_BYTES equals 10485760', () => {
    expect(MAX_BYTES).toBe(10485760);
  });

  test('DEFAULT_MAX_STEPS_PER_RUN equals 15', () => {
    expect(DEFAULT_MAX_STEPS_PER_RUN).toBe(15);
  });

  test('SNAP_TTL default is 24h', () => {
    expect(SNAP_TTL.default).toBe('24h');
    expect(SNAP_TTL.values).toEqual(['15m', '1h', '24h']);
    expect(SNAP_TTL_VALUES).toEqual(['15m', '1h', '24h']);
    expect(SNAP_TTL.seconds['15m']).toBe(15 * 60);
    expect(SNAP_TTL.seconds['1h']).toBe(60 * 60);
    expect(SNAP_TTL.seconds['24h']).toBe(24 * 60 * 60);
  });

  test('MAX_PIXELS equals 50000000', () => {
    expect(MAX_PIXELS).toBe(50000000);
  });

  test('DEFAULT_DRAFT_IMAGE_DAYS equals 7', () => {
    expect(DEFAULT_DRAFT_IMAGE_DAYS).toBe(7);
  });

  test('PUBLIC_ID_LENGTH equals 16', () => {
    expect(PUBLIC_ID_LENGTH).toBe(16);
  });

  test('CLI_MIN_VERSION is semver format', () => {
    expect(CLI_MIN_VERSION).toBe('0.1.0-alpha.1');
    expect(/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(CLI_MIN_VERSION)).toBe(true);
  });

  test('STEP_TITLE_MAX equals 60', () => {
    expect(STEP_TITLE_MAX).toBe(60);
  });

  test('STEP_ALT_MAX equals 300', () => {
    expect(STEP_ALT_MAX).toBe(300);
  });
});
