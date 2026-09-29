/**
 * Deterministic hash used to sign a redaction report: the same nonce, boxes
 * and target must produce the same signature whether computed in the page
 * (the emitted script, see {@link canonicalReportSourceLines}) or here in the
 * CLI (verifying an incoming report). Both copies must stay byte-for-byte
 * identical, hence sharing this file's algorithm as the source of truth and
 * emitting equivalent source for the page.
 */

/** Round to 2 decimal places; canonicalizes CSS px floats before hashing. */
export function roundTo2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** FNV-1a 32-bit hash, returned as 8 lowercase hex digits. */
export function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export interface HashBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HashTarget {
  x: number;
  y: number;
  w: number;
  h: number;
  vw: number;
  vh: number;
  sx: number;
  sy: number;
}

export interface HashViewport {
  w: number;
  h: number;
  dpr: number;
}

/**
 * Canonical string signed by {@link fnv1aHex}:
 * nonce|count|boxes json|target json (or "none")|target_error|viewport json (or "none")|iframes.
 */
export function canonicalReportString(
  nonce: string,
  count: number,
  boxes: readonly HashBox[] | undefined,
  target: HashTarget | undefined,
  targetError: string | undefined,
  viewport?: HashViewport,
  iframes?: number
): string {
  const roundedBoxes = (boxes ?? []).map((b) => ({
    x: roundTo2(b.x),
    y: roundTo2(b.y),
    w: roundTo2(b.w),
    h: roundTo2(b.h),
  }));
  const targetPart = target
    ? JSON.stringify({
        x: roundTo2(target.x),
        y: roundTo2(target.y),
        w: roundTo2(target.w),
        h: roundTo2(target.h),
        vw: roundTo2(target.vw),
        vh: roundTo2(target.vh),
        sx: roundTo2(target.sx),
        sy: roundTo2(target.sy),
      })
    : 'none';
  const viewportPart = viewport
    ? JSON.stringify({ w: roundTo2(viewport.w), h: roundTo2(viewport.h), dpr: roundTo2(viewport.dpr) })
    : 'none';
  const iframesPart = iframes ?? 0;
  return (
    `${nonce}|${count}|${JSON.stringify(roundedBoxes)}|${targetPart}|${targetError ?? ''}` +
    `|${viewportPart}|${iframesPart}`
  );
}

/** Compute the report signature: {@link fnv1aHex} of {@link canonicalReportString}. */
export function computeReportSig(
  nonce: string,
  count: number,
  boxes: readonly HashBox[] | undefined,
  target: HashTarget | undefined,
  targetError: string | undefined,
  viewport?: HashViewport,
  iframes?: number
): string {
  return fnv1aHex(canonicalReportString(nonce, count, boxes, target, targetError, viewport, iframes));
}

/**
 * Source lines of an equivalent implementation, emitted verbatim into the
 * browser-side script (see redact/script.ts). Kept as a template here so a
 * change to the algorithm above is a visible reminder to update this too;
 * the accompanying test proves both sides agree on the same hash for the
 * same input.
 */
export function canonicalReportSourceLines(): string[] {
  return [
    'function fnv1aHex(str) {',
    '  var hash = 0x811c9dc5;',
    '  for (var i = 0; i < str.length; i++) {',
    '    hash ^= str.charCodeAt(i);',
    '    hash = Math.imul(hash, 0x01000193);',
    '  }',
    '  return (hash >>> 0).toString(16).padStart(8, "0");',
    '}',

    'function roundTo2(n) { return Math.round(n * 100) / 100; }',

    'function canonicalReportString(nonce, count, boxes, target, targetError, viewport, iframes) {',
    '  var roundedBoxes = (boxes || []).map(function (b) {',
    '    return { x: roundTo2(b.x), y: roundTo2(b.y), w: roundTo2(b.w), h: roundTo2(b.h) };',
    '  });',
    '  var targetPart = target ? JSON.stringify({',
    '    x: roundTo2(target.x), y: roundTo2(target.y), w: roundTo2(target.w), h: roundTo2(target.h),',
    '    vw: roundTo2(target.vw), vh: roundTo2(target.vh), sx: roundTo2(target.sx), sy: roundTo2(target.sy)',
    '  }) : "none";',
    '  var viewportPart = viewport ? JSON.stringify({',
    '    w: roundTo2(viewport.w), h: roundTo2(viewport.h), dpr: roundTo2(viewport.dpr)',
    '  }) : "none";',
    '  var iframesPart = iframes || 0;',
    '  return nonce + "|" + count + "|" + JSON.stringify(roundedBoxes) + "|" + targetPart + "|" + (targetError || "") +',
    '    "|" + viewportPart + "|" + iframesPart;',
    '}',

    'function computeReportSig(nonce, count, boxes, target, targetError, viewport, iframes) {',
    '  return fnv1aHex(canonicalReportString(nonce, count, boxes, target, targetError, viewport, iframes));',
    '}',
  ];
}
