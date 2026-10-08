import { describe, expect, test } from 'bun:test';
import { apiErrorMessage } from './api-error';

describe('apiErrorMessage', () => {
  test('reads body.error.message', () => {
    expect(apiErrorMessage({ error: { code: 'x', message: 'Nope' } }, 'fallback')).toBe('Nope');
  });

  test('falls back for anything else', () => {
    expect(apiErrorMessage(null, 'fallback')).toBe('fallback');
    expect(apiErrorMessage({ error: 'oops' }, 'fallback')).toBe('fallback');
  });
});
