import { describe, expect, test } from 'bun:test';
import {
  isLuhnValid,
  maskText,
  maskTextWithDetails,
  REDACTION_PATTERNS,
} from './redaction';

describe('redaction patterns and masking', () => {
  test('masks email', () => {
    expect(maskText('Enter user@example.com in the field')).toBe(
      'Enter [email] in the field'
    );
    expect(maskText('Contact support.team+dev@sub.company.co.id for help')).toBe(
      'Contact [email] for help'
    );
  });

  test('masks Indonesian phone number', () => {
    expect(maskText('Call +6281234567890 for details')).toBe(
      'Call [phone] for details'
    );
    expect(maskText('Dial 081234567890 now')).toBe('Dial [phone] now');
    expect(maskText('Phone: +62 812-3456-7890')).toBe('Phone: [phone]');
    expect(maskText('Mobile: 0812-3456-7890')).toBe('Mobile: [phone]');
  });

  test('masks NIK', () => {
    // 16-digit Indonesian NIK that does not pass Luhn
    const nik = '3171010101900002';
    expect(isLuhnValid(nik)).toBe(false);
    expect(maskText(`NIK: ${nik}`)).toBe('NIK: [nik]');
  });

  test('masks Luhn-valid card', () => {
    // 16-digit Visa card candidate that is Luhn valid
    const validCardFormatted = '4532-0151-1283-0366';
    const validCardRaw = '4532015112830366';
    expect(isLuhnValid(validCardRaw)).toBe(true);

    // Formatted card is masked as [card]
    expect(maskText(`Card: ${validCardFormatted}`)).toBe('Card: [card]');

    // Contiguous card number: card rule precedes NIK, so it is masked as [card], NOT [nik]
    expect(maskText(`Pay with ${validCardRaw}`)).toBe('Pay with [card]');
  });

  test('does not mask Luhn-invalid 16-digit number', () => {
    // Formatted 16-digit number that fails Luhn is NOT masked as [card]
    const invalidCardFormatted = '4532-0151-1283-0367';
    expect(isLuhnValid(invalidCardFormatted)).toBe(false);
    expect(maskText(`Number: ${invalidCardFormatted}`)).toBe(
      `Number: ${invalidCardFormatted}`
    );
  });

  test('masks NPWP', () => {
    expect(maskText('NPWP: 01.234.567.8-901.000')).toBe('NPWP: [npwp]');
    expect(maskText('Tax ID: 012345678901000')).toBe('Tax ID: [npwp]');
  });

  test('masks token prefixes and JWT', () => {
    const skLive = ['sk', 'live', 'a'.repeat(24)].join('_');
    const skTest = ['sk', 'test', 'b'.repeat(24)].join('_');
    const ghp = 'gh' + 'p_' + 'a'.repeat(36);
    const akia = ['AK', 'IA'].join('') + 'Z'.repeat(16);
    const jwt = [
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      'eyJzdWIiOiIxMjM0NTY3ODkwIn0',
      'doNotLeakThisSignature',
    ].join('.');

    expect(maskText(`Key ${skLive}`)).toBe('Key [token]');
    expect(maskText(`Key ${skTest}`)).toBe('Key [token]');
    expect(maskText(`Token ${ghp}`)).toBe('Token [token]');
    expect(maskText(`Access Key: ${akia}`)).toBe('Access Key: [token]');
    expect(maskText(`Authorization: Bearer ${jwt}`)).toBe(
      'Authorization: Bearer [token]'
    );
  });

  test('leaves clean text unchanged', () => {
    const clean = 'Click on the settings icon, then select General preferences';
    expect(maskText(clean)).toBe(clean);
  });

  test('masks multiple PII types in one string', () => {
    const mixed =
      'User user@example.com with phone 081234567890 paid with 4532-0151-1283-0366 using token ' +
      ['sk', 'live', 'c'.repeat(24)].join('_');
    const result = maskTextWithDetails(mixed);
    expect(result.text).toBe(
      'User [email] with phone [phone] paid with [card] using token [token]'
    );
    expect(result.count).toBe(4);
    expect(result.tags).toEqual(['[token]', '[email]', '[card]', '[phone]']);
  });

  test('isLuhnValid handles various lengths and checksums', () => {
    expect(isLuhnValid('4532015112830366')).toBe(true);
    expect(isLuhnValid('4532015112830367')).toBe(false);
    expect(isLuhnValid('123')).toBe(false); // too short
    expect(isLuhnValid('123456789012345678901')).toBe(false); // too long
  });

  test('exports REDACTION_PATTERNS object', () => {
    expect(REDACTION_PATTERNS.email).toBeDefined();
    expect(REDACTION_PATTERNS.phoneId).toBeDefined();
    expect(REDACTION_PATTERNS.nik).toBeDefined();
    expect(REDACTION_PATTERNS.npwp).toBeDefined();
    expect(REDACTION_PATTERNS.token).toBeDefined();
  });
});
