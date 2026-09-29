import { expect, test } from 'bun:test';
import { canonicalReportSourceLines, canonicalReportString, computeReportSig, fnv1aHex, roundTo2 } from './hash';

test('fnv1a hash matches known vectors', () => {
  expect(fnv1aHex('')).toBe('811c9dc5');
  expect(fnv1aHex('a')).toBe('e40c292c');
  expect(fnv1aHex('hello')).toBe('4f9f2cab');
});

test('roundTo2 rounds to 2 decimal places', () => {
  expect(roundTo2(1.005)).toBe(1);
  expect(roundTo2(100.999)).toBe(101);
  expect(roundTo2(494.001)).toBe(494);
});

test('canonicalReportString with no boxes and no target', () => {
  expect(canonicalReportString('nonce-1', 0, [], undefined, undefined)).toBe('nonce-1|0|[]|none|');
});

test('canonicalReportString with boxes and a target', () => {
  const boxes = [{ x: 494, y: 154, w: 292, h: 37 }];
  const target = { x: 494, y: 154, w: 292, h: 37, vw: 1280, vh: 800, sx: 0, sy: 0 };
  expect(canonicalReportString('abc-nonce', 1, boxes, target, undefined)).toBe(
    'abc-nonce|1|[{"x":494,"y":154,"w":292,"h":37}]|' +
      '{"x":494,"y":154,"w":292,"h":37,"vw":1280,"vh":800,"sx":0,"sy":0}|'
  );
});

test('canonicalReportString rounds every field to 2 decimals', () => {
  const boxes = [{ x: 1.005, y: 2, w: 3, h: 4 }];
  expect(canonicalReportString('xyz', 2, boxes, undefined, 'not found: X')).toBe(
    'xyz|2|[{"x":1,"y":2,"w":3,"h":4}]|none|not found: X'
  );
});

test('computeReportSig matches known vectors', () => {
  expect(computeReportSig('nonce-1', 0, [], undefined, undefined)).toBe('3a3ddaf8');
  const boxes = [{ x: 494, y: 154, w: 292, h: 37 }];
  const target = { x: 494, y: 154, w: 292, h: 37, vw: 1280, vh: 800, sx: 0, sy: 0 };
  expect(computeReportSig('abc-nonce', 1, boxes, target, undefined)).toBe('179e2bf5');
  expect(computeReportSig('xyz', 2, [{ x: 1.005, y: 2, w: 3, h: 4 }], undefined, 'not found: X')).toBe('543e5d8f');
});

test('computeReportSig changes if any input changes', () => {
  const base = computeReportSig('nonce-1', 1, [{ x: 1, y: 2, w: 3, h: 4 }], undefined, undefined);
  expect(computeReportSig('nonce-2', 1, [{ x: 1, y: 2, w: 3, h: 4 }], undefined, undefined)).not.toBe(base);
  expect(computeReportSig('nonce-1', 2, [{ x: 1, y: 2, w: 3, h: 4 }], undefined, undefined)).not.toBe(base);
  expect(computeReportSig('nonce-1', 1, [{ x: 9, y: 2, w: 3, h: 4 }], undefined, undefined)).not.toBe(base);
});

test('emitted source implements the same algorithm as the TS helper', () => {
  const src = canonicalReportSourceLines().join('\n');
  expect(src).toContain('0x811c9dc5');
  expect(src).toContain('0x01000193');
  expect(src).toContain('Math.round(n * 100) / 100');
  expect(src).toContain('nonce + "|" + count + "|" + JSON.stringify(roundedBoxes) + "|" + targetPart');

  // Evaluate the emitted source directly (no `window`/`document` needed - these
  // are pure functions) and confirm it produces the same hash as the TS helper
  // for the same input, proving both copies of the algorithm agree.
  const fn = new Function(`${src}\nreturn computeReportSig;`)() as typeof computeReportSig;
  const boxes = [{ x: 494, y: 154, w: 292, h: 37 }];
  const target = { x: 494, y: 154, w: 292, h: 37, vw: 1280, vh: 800, sx: 0, sy: 0 };
  expect(fn('abc-nonce', 1, boxes, target, undefined)).toBe(computeReportSig('abc-nonce', 1, boxes, target, undefined));
  expect(fn('nonce-1', 0, [], undefined, undefined)).toBe(computeReportSig('nonce-1', 0, [], undefined, undefined));
});
