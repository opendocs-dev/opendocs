import { expect, test } from 'bun:test';
import {
  CARD_CANDIDATE_PATTERN,
  EMAIL_PATTERN,
  NIK_PATTERN,
  NPWP_PATTERN,
  PHONE_ID_PATTERN,
  TOKEN_PATTERN,
} from '@opendocs/core/redaction';
import { computeReportSig } from './hash';
import { buildInstallScript, buildOneLineCall, SCRIPT_VERSION } from './script';

/** Evaluate an emitted `() => {...}` script source and return the arrow function. */
function toFunction(src: string): (...args: unknown[]) => unknown {
  return new Function(`return ${src}`)() as (...args: unknown[]) => unknown;
}

test('install script parses as a function and runs', () => {
  const src = buildInstallScript({ mode: 'strict', nonce: 'n1' });
  const fn = toFunction(src);
  expect(typeof fn).toBe('function');
});

test('one-line call parses as a function', () => {
  const src = buildOneLineCall({ mode: 'strict', nonce: 'n1' });
  const fn = toFunction(src);
  expect(typeof fn).toBe('function');
});

test('install script embeds every core pattern source', () => {
  const src = buildInstallScript({ mode: 'strict', nonce: 'n1' });
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

test('basic mode install script also parses and embeds patterns', () => {
  const src = buildInstallScript({ mode: 'basic', nonce: 'n1' });
  const fn = toFunction(src);
  expect(typeof fn).toBe('function');
  expect(src).toContain(JSON.stringify(EMAIL_PATTERN.source));
});

test('install script embeds custom selectors and allow list', () => {
  const src = buildInstallScript({
    mode: 'strict',
    nonce: 'n1',
    selectors: ['.my-secret'],
    allow: ['.public-ok'],
  });
  expect(src).toContain('.my-secret');
  expect(src).toContain('.public-ok');
});

test('install script embeds the script version', () => {
  const src = buildInstallScript({ mode: 'strict', nonce: 'n1' });
  expect(src).toContain(JSON.stringify(SCRIPT_VERSION));
});

test('install script embeds the nonce', () => {
  const src = buildInstallScript({ mode: 'strict', nonce: 'nonce-abc-123' });
  expect(src).toContain('"nonce":"nonce-abc-123"');
});

test('redaction_script returns the one-line call by default and the full script with install:true', () => {
  const short = buildOneLineCall({ mode: 'strict', nonce: 'n1' });
  const full = buildInstallScript({ mode: 'strict', nonce: 'n1' });
  expect(short.length).toBeLessThan(full.length);
  expect(short).toContain('window.__opendocs');
  expect(full).toContain('window.__opendocs = { version:');
});

test('full script is minified (no leading indentation lines)', () => {
  const full = buildInstallScript({ mode: 'strict', nonce: 'n1' });
  expect(full.includes('\n')).toBe(false);
  expect(full.includes('  ')).toBe(false);
});

test('off mode script still bakes in the target and skips redaction', () => {
  const src = buildInstallScript({ mode: 'off', nonce: 'n1', target_text: 'Add to cart' });
  expect(src).toContain('"mode":"off"');
  expect(src).toContain('"target_text":"Add to cart"');
});

test('matches target text across line breaks', () => {
  // Both the wanted text and each candidate's text are collapsed with the same
  // /\s+/g + trim + lowercase normalization before comparing, so "Bun v1.4.2\nLatest"
  // (an innerText with a line break) matches a needle of "Bun v1.4.2 Latest".
  const src = buildInstallScript({ mode: 'strict', nonce: 'n1', target_text: 'Bun v1.4.2 Latest' });
  expect(src).toContain('function normalizeText(text)');
  expect(src).toContain('replace(/\\s+/g, " ")');
  expect(src).toContain('needle = normalizeText(text)');
  expect(src).toContain('normalizeText(texts[j])');
});

test('reports target outside the viewport', () => {
  const src = buildInstallScript({ mode: 'strict', nonce: 'n1', target_text: 'Add to cart' });
  expect(src).toContain('target outside the viewport');
  expect(src).toContain('trect.bottom <= 0');
  expect(src).toContain('trect.top >= window.innerHeight');
  expect(src).toContain('trect.right <= 0');
  expect(src).toContain('trect.left >= window.innerWidth');
});

test('uses instant scroll', () => {
  const src = buildInstallScript({ mode: 'strict', nonce: 'n1', target_text: 'Add to cart' });
  expect(src).toContain('behavior: "instant"');
});

test('scrolls to the nearest edge, not the viewport centre', () => {
  const src = buildInstallScript({ mode: 'strict', nonce: 'n1', target_text: 'Add to cart' });
  expect(src).toContain('block: "nearest", inline: "nearest", behavior: "instant"');
});

test('one-line call is gated on the current script version', () => {
  const src = buildOneLineCall({ mode: 'strict', nonce: 'n1' });
  expect(src).toContain(JSON.stringify(SCRIPT_VERSION));
});

test('placeholder attribute is considered when matching target text', () => {
  const src = buildInstallScript({ mode: 'strict', nonce: 'n1', target_text: 'Search products' });
  expect(src).toContain('getAttribute("placeholder")');
  expect(src).toContain('parts.push(placeholder)');
});

test('report is signed with a nonce and signature computed the same way as the CLI helper', () => {
  (globalThis as unknown as { window?: unknown }).window = {};
  try {
    const src = buildInstallScript({ mode: 'off', nonce: 'test-nonce-1' });
    const fn = toFunction(src) as () => { nonce: string; sig: string; count: number; boxes: unknown[] };
    const report = fn();
    expect(report.nonce).toBe('test-nonce-1');
    expect(computeReportSig('test-nonce-1', report.count, report.boxes as never, undefined, undefined)).toBe(
      report.sig
    );
  } finally {
    delete (globalThis as unknown as { window?: unknown }).window;
  }
});

// No DOM test library (e.g. happy-dom) is a devDependency here, so target-finding
// and redaction behavior inside a real page are exercised via MCP integration
// tests (mcp.test.ts) with a hand-built report instead of running the script itself.
