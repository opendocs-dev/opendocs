import { describe, expect, test } from 'bun:test';
import { addressMessage, apiErrorMessage, formatAddressSuffix } from './site-address';

describe('addressMessage', () => {
  test('returns Available for available status', () => {
    const msg = addressMessage('available');
    expect(msg.tone).toBe('ok');
    expect(msg.text).toBe('Available');
  });

  test('returns Already in use for taken status', () => {
    const msg = addressMessage('taken');
    expect(msg.tone).toBe('bad');
    expect(msg.text).toBe('Already in use');
  });

  test('returns Reserved name for reserved status', () => {
    const msg = addressMessage('reserved');
    expect(msg.tone).toBe('warn');
    expect(msg.text).toBe('Reserved name, pick another');
  });

  test('uses provided reason for invalid status', () => {
    const msg = addressMessage('invalid', 'Too short');
    expect(msg.tone).toBe('bad');
    expect(msg.text).toBe('Too short');
  });

  test('uses default message for invalid status when no reason provided', () => {
    const msg = addressMessage('invalid');
    expect(msg.tone).toBe('bad');
    expect(msg.text).toBe('Use 3-30 letters, numbers and hyphens');
  });

  test('uses default message when reason is null', () => {
    const msg = addressMessage('invalid', null);
    expect(msg.tone).toBe('bad');
    expect(msg.text).toBe('Use 3-30 letters, numbers and hyphens');
  });

  test('ignores current parameter', () => {
    const msg1 = addressMessage('available', undefined, 'old-address');
    const msg2 = addressMessage('available');
    expect(msg1).toEqual(msg2);
  });
});

describe('apiErrorMessage', () => {
  test('extracts error message from error response body', () => {
    const body = { error: { code: 'CONFLICT', message: 'Already taken' } };
    expect(apiErrorMessage(body, 'default')).toBe('Already taken');
  });

  test('returns fallback when body.error.message is missing', () => {
    const body = { error: { code: 'CONFLICT' } };
    expect(apiErrorMessage(body, 'fallback message')).toBe('fallback message');
  });

  test('returns fallback when body.error is missing', () => {
    const body = { code: 'CONFLICT', message: 'text' };
    expect(apiErrorMessage(body, 'fallback')).toBe('fallback');
  });

  test('returns fallback when body is not an object', () => {
    expect(apiErrorMessage('string', 'fallback')).toBe('fallback');
    expect(apiErrorMessage(null, 'fallback')).toBe('fallback');
    expect(apiErrorMessage(undefined, 'fallback')).toBe('fallback');
  });

  test('returns fallback when error.message is not a string', () => {
    const body = { error: { message: 123 } };
    expect(apiErrorMessage(body, 'fallback')).toBe('fallback');
  });

  test('returns fallback when error is not an object', () => {
    const body = { error: 'error string' };
    expect(apiErrorMessage(body, 'fallback')).toBe('fallback');
  });

  test('handles malformed deeply nested structures safely', () => {
    const body = { error: { message: { nested: 'object' } } };
    expect(apiErrorMessage(body, 'fallback')).toBe('fallback');
  });
});

describe('formatAddressSuffix', () => {
  test('returns fallback for null or undefined host', () => {
    expect(formatAddressSuffix(null)).toBe('.opendocs.xxx');
    expect(formatAddressSuffix(undefined)).toBe('.opendocs.xxx');
    expect(formatAddressSuffix('')).toBe('.opendocs.xxx');
  });

  test('extracts domain suffix when host has subdomain', () => {
    expect(formatAddressSuffix('my-team.opendocs.xxx')).toBe('.opendocs.xxx');
    expect(formatAddressSuffix('guides.company.com')).toBe('.company.com');
  });

  test('falls back when host has no dots', () => {
    expect(formatAddressSuffix('localhost')).toBe('.opendocs.xxx');
  });
});
