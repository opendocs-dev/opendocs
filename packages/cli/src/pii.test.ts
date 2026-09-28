import { expect, test } from 'bun:test';
import { maskStepText } from './pii';

// Token-shaped values assembled at runtime: no secret-looking literals in source.
const skKey = ['sk', 'live', 'aaaabbbbccccddddeeee'].join('_');
const ghpKey = ['ghp', '1234567890abcdef1234'].join('_');
const jwt = [
  'eyJhbGciOiJIUzI1NiJ9',
  'eyJzdWIiOiIxMjM0NTY3ODkwIn0',
  'dGVzdHNpZ25hdHVyZQ',
].join('.');

test('masks email', () => {
  const result = maskStepText('Contact me at jane.doe@example.com for details');
  expect(result.text).toBe('Contact me at [email] for details');
  expect(result.count).toBe(1);
});

test('masks Indonesian phone number', () => {
  const result = maskStepText('Call 081234567890 now');
  expect(result.text).toBe('Call [phone] now');
  expect(result.count).toBe(1);
});

test('masks NIK', () => {
  const result = maskStepText('NIK: 3201234567890123');
  expect(result.text).toBe('NIK: [nik]');
  expect(result.count).toBe(1);
});

test('masks Luhn-valid card', () => {
  const result = maskStepText('Card 4532015112830366 was charged');
  expect(result.text).toBe('Card [card] was charged');
  expect(result.count).toBe(1);
});

test('does not mask Luhn-invalid 16-digit number', () => {
  const result = maskStepText('Number 1234567890123456 is not a card');
  expect(result.text).toBe('Number [nik] is not a card');
  expect(result.count).toBe(1);
});

test('masks token prefixes and JWT', () => {
  const skResult = maskStepText(`Use key ${skKey} to auth`);
  expect(skResult.text).toBe('Use key [token] to auth');
  expect(skResult.count).toBe(1);

  const ghpResult = maskStepText(`Token is ${ghpKey}`);
  expect(ghpResult.text).toBe('Token is [token]');
  expect(ghpResult.count).toBe(1);

  const jwtResult = maskStepText(`Bearer ${jwt}`);
  expect(jwtResult.text).toBe('Bearer [token]');
  expect(jwtResult.count).toBe(1);
});

test('leaves clean text unchanged', () => {
  const result = maskStepText('Click the blue submit button');
  expect(result.text).toBe('Click the blue submit button');
  expect(result.count).toBe(0);
});

test('masks independent of redact mode off', () => {
  // maskStepText has no mode parameter: it always masks regardless of the
  // caller's redact setting.
  const result = maskStepText('Email jane.doe@example.com even when redact is off');
  expect(result.text).toBe('Email [email] even when redact is off');
  expect(result.count).toBe(1);
});
