import { expect, test } from 'bun:test';
import {
  CARD_CANDIDATE_PATTERN,
  EMAIL_PATTERN,
  NIK_PATTERN,
  NPWP_PATTERN,
  PHONE_ID_PATTERN,
  TOKEN_PATTERN,
} from '@opendocs/core/redaction';
import { buildRedactionScript, SCRIPT_VERSION } from './script';

test('built source parses as a function', () => {
  const src = buildRedactionScript({ mode: 'strict' });
  const fn = new Function(`return ${src}`)();
  expect(typeof fn).toBe('function');
});

test('embeds every core pattern source', () => {
  const src = buildRedactionScript({ mode: 'strict' });
  for (const pattern of [
    EMAIL_PATTERN,
    PHONE_ID_PATTERN,
    CARD_CANDIDATE_PATTERN,
    NIK_PATTERN,
    NPWP_PATTERN,
    TOKEN_PATTERN,
  ]) {
    expect(src).toContain(JSON.stringify(pattern.source));
  }
});

test('basic mode script also parses and embeds patterns', () => {
  const src = buildRedactionScript({ mode: 'basic' });
  const fn = new Function(`return ${src}`)();
  expect(typeof fn).toBe('function');
  expect(src).toContain(JSON.stringify(EMAIL_PATTERN.source));
});

test('embeds custom selectors and allow list', () => {
  const src = buildRedactionScript({
    mode: 'strict',
    selectors: ['.my-secret'],
    allow: ['.public-ok'],
  });
  expect(src).toContain('.my-secret');
  expect(src).toContain('.public-ok');
});

test('embeds the script version', () => {
  const src = buildRedactionScript({ mode: 'strict' });
  expect(src).toContain(JSON.stringify(SCRIPT_VERSION));
});
