/**
 * Builds the source of a self-contained browser-side redaction + target-finding
 * script.
 *
 * The agent gets this text via `opendocs_redaction_script` and runs it in the
 * page with its browser tool (`evaluate_script` / `browser_evaluate`). The full
 * form (`buildInstallScript`) installs `window.__opendocs = { version, run }`
 * once per page load (skipped if already installed at the current
 * SCRIPT_VERSION) and calls `run`; the short form (`buildOneLineCall`) just
 * calls the already-installed `run`, returning `{installed: false}` if it
 * is not there yet so the caller knows to fall back to the full form. Both
 * bake the same per-call options (mode, nonce, selectors, allow, target) as
 * a JSON literal, so the emitted text has no imports and no references to
 * anything outside itself at runtime. The returned report carries the
 * baked-in nonce and a signature over its own contents (see redact/hash.ts),
 * so the MCP server can tell a genuine report from an edited or invented one.
 */
import {
  CARD_CANDIDATE_PATTERN,
  EMAIL_PATTERN,
  NIK_PATTERN,
  NPWP_PATTERN,
  PHONE_ID_PATTERN,
  TOKEN_PATTERN,
} from '@opendocs/core/redaction';
import { canonicalReportSourceLines } from './hash';

/** Bumped whenever the emitted script's behavior changes; travels in the report. */
export const SCRIPT_VERSION = '5';

/** Per-call options baked into the emitted script as a JSON literal. */
export interface RunOptions {
  mode: 'strict' | 'basic' | 'off';
  /** Anti-tampering nonce issued by the MCP server; signs the returned report. */
  nonce: string;
  selectors?: string[];
  allow?: string[];
  target_selector?: string;
  target_text?: string;
}

const BUILTIN_COVER_SELECTORS = [
  'input[type="password"]',
  '[autocomplete^="cc-"]',
  '[autocomplete="one-time-code"]',
  '[data-od-redact]',
];

/** Interactive elements considered when locating a target by visible text. */
const TEXT_TARGET_SELECTOR = [
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'summary',
  '[role=button]',
  '[role=link]',
  '[role=tab]',
  '[role=menuitem]',
  '[role=checkbox]',
  '[role=option]',
].join(', ');

/** Pattern name/regex pairs, in the order embedded into the emitted script. */
const PATTERN_DEFS = [
  { name: 'email', pattern: EMAIL_PATTERN },
  { name: 'phoneId', pattern: PHONE_ID_PATTERN },
  { name: 'cardCandidate', pattern: CARD_CANDIDATE_PATTERN },
  { name: 'nik', pattern: NIK_PATTERN },
  { name: 'npwp', pattern: NPWP_PATTERN },
  { name: 'token', pattern: TOKEN_PATTERN },
] as const;

const CARD_PATTERN_INDEX = PATTERN_DEFS.findIndex((def) => def.name === 'cardCandidate');

/**
 * Lines making up the body of the `if (not yet installed) { ... }` block:
 * constants, helpers, the `run(opts)` function, and the assignment to
 * `window.__opendocs`. Shared by {@link buildInstallScript}; never emitted on
 * its own since `run` closes over the helpers defined alongside it here.
 */
function coreLines(): string[] {
  const patternSources = PATTERN_DEFS.map((def) => def.pattern.source);

  return [
    `var PATTERN_SOURCES = ${JSON.stringify(patternSources)};`,
    `var CARD_PATTERN_INDEX = ${JSON.stringify(CARD_PATTERN_INDEX)};`,
    `var BUILTIN_COVER_SELECTORS = ${JSON.stringify(BUILTIN_COVER_SELECTORS)};`,
    `var TEXT_TARGET_SELECTOR = ${JSON.stringify(TEXT_TARGET_SELECTOR)};`,
    'var MAX_BOXES = 200;',
    'var MAX_TEXT_NODES = 50000;',
    'var HIT_SELECTOR = "[data-od-redact-hit]";',

    'function isLuhnValid(value) {',
    '  var digits = value.replace(/\\D/g, "");',
    '  if (digits.length < 13 || digits.length > 19) return false;',
    '  var sum = 0;',
    '  var alternate = false;',
    '  for (var i = digits.length - 1; i >= 0; i--) {',
    '    var n = parseInt(digits.charAt(i), 10);',
    '    if (isNaN(n)) return false;',
    '    if (alternate) { n *= 2; if (n > 9) n -= 9; }',
    '    sum += n;',
    '    alternate = !alternate;',
    '  }',
    '  return sum % 10 === 0;',
    '}',

    'function textMatchesAnyPattern(text) {',
    '  for (var p = 0; p < PATTERN_SOURCES.length; p++) {',
    '    var re = new RegExp(PATTERN_SOURCES[p], "g");',
    '    var match;',
    '    while ((match = re.exec(text)) !== null) {',
    '      if (p === CARD_PATTERN_INDEX) {',
    '        var digitsOnly = match[0].replace(/\\D/g, "");',
    '        if (!isLuhnValid(digitsOnly)) continue;',
    '      }',
    '      return true;',
    '    }',
    '  }',
    '  return false;',
    '}',

    // Every open shadow root gets its own copy of the redaction style: CSS never
    // crosses the shadow boundary, so a document-level rule would report a match
    // as covered while it stays visible.
    'function collectShadowRoots(root, out) {',
    '  out.push(root);',
    '  var all = root.querySelectorAll("*");',
    '  for (var i = 0; i < all.length; i++) {',
    '    if (all[i].shadowRoot) collectShadowRoots(all[i].shadowRoot, out);',
    '  }',
    '}',

    'function markTextHits(root, seenSoFar) {',
    '  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);',
    '  var node = walker.nextNode();',
    '  var seen = seenSoFar;',
    '  while (node) {',
    '    seen++;',
    // Fail closed: no report means the CLI refuses the upload, never a partial redaction.
    '    if (seen > MAX_TEXT_NODES) throw new Error("opendocs redaction: page too large to scan; mark sensitive areas with data-od-redact or use redact off");',
    '    var text = node.textContent || "";',
    '    if (text.trim().length > 0 && textMatchesAnyPattern(text)) {',
    '      var parent = node.parentElement;',
    '      if (parent) parent.setAttribute("data-od-redact-hit", "");',
    '    }',
    '    node = walker.nextNode();',
    '  }',
    '  return seen;',
    '}',

    'function installStyle(host, css) {',
    '  var old = host.querySelectorAll("style[data-od-redact]");',
    '  for (var o = 0; o < old.length; o++) old[o].parentNode.removeChild(old[o]);',
    '  var style = document.createElement("style");',
    '  style.setAttribute("data-od-redact", "");',
    '  if (host === document) style.id = "od-redact";',
    '  style.textContent = css;',
    '  (host === document ? (document.head || document.documentElement) : host).appendChild(style);',
    '}',

    'function findAllDeep(selector) {',
    '  var results = [];',
    '  function walk(root) {',
    '    var found = root.querySelectorAll(selector);',
    '    for (var i = 0; i < found.length; i++) results.push(found[i]);',
    '    var all = root.querySelectorAll("*");',
    '    for (var j = 0; j < all.length; j++) {',
    '      if (all[j].shadowRoot) walk(all[j].shadowRoot);',
    '    }',
    '  }',
    '  walk(document);',
    '  return results;',
    '}',

    'function isVisible(el) {',
    '  var rect = el.getBoundingClientRect();',
    '  if (rect.width <= 0 || rect.height <= 0) return false;',
    '  var computed = getComputedStyle(el);',
    '  if (computed.visibility === "hidden" || computed.display === "none") return false;',
    '  return true;',
    '}',

    'function areaOf(el) {',
    '  var r = el.getBoundingClientRect();',
    '  return r.width * r.height;',
    '}',

    'function findTargetBySelector(selector) {',
    '  var found = findAllDeep(selector);',
    '  for (var i = 0; i < found.length; i++) {',
    '    if (isVisible(found[i])) return found[i];',
    '  }',
    '  return null;',
    '}',

    'function elementSearchTexts(el) {',
    '  var parts = [];',
    '  if (el.innerText) parts.push(el.innerText);',
    '  if (el.value !== undefined && el.value !== null) parts.push(String(el.value));',
    '  var aria = el.getAttribute && el.getAttribute("aria-label");',
    '  if (aria) parts.push(aria);',
    '  var title = el.getAttribute && el.getAttribute("title");',
    '  if (title) parts.push(title);',
    '  var placeholder = el.getAttribute && el.getAttribute("placeholder");',
    '  if (placeholder) parts.push(placeholder);',
    '  return parts;',
    '}',

    // Text on the page often carries line breaks a human would read as a single
    // space (e.g. a version badge with the tag on its own line), so both the
    // wanted text and every candidate text are collapsed the same way before
    // comparing.
    'function normalizeText(text) {',
    '  return text.replace(/\\s+/g, " ").trim().toLowerCase();',
    '}',

    // Exact match (case-insensitive, whitespace-collapsed) beats a mere substring
    // match; within a tier the smallest visible element wins, so a link's tiny
    // icon-only child does not lose to the whole nav bar it sits inside.
    'function findTargetByText(text) {',
    '  var needle = normalizeText(text);',
    '  var candidates = findAllDeep(TEXT_TARGET_SELECTOR);',
    '  var exact = [];',
    '  var contains = [];',
    '  for (var i = 0; i < candidates.length; i++) {',
    '    var el = candidates[i];',
    '    if (!isVisible(el)) continue;',
    '    var texts = elementSearchTexts(el);',
    '    var isExact = false;',
    '    var isContains = false;',
    '    for (var j = 0; j < texts.length; j++) {',
    '      var t = normalizeText(texts[j]);',
    '      if (!t) continue;',
    '      if (t === needle) { isExact = true; break; }',
    '      if (t.indexOf(needle) !== -1) isContains = true;',
    '    }',
    '    if (isExact) exact.push(el);',
    '    else if (isContains) contains.push(el);',
    '  }',
    '  var pool = exact.length ? exact : contains;',
    '  if (!pool.length) return null;',
    '  var best = pool[0];',
    '  var bestArea = areaOf(best);',
    '  for (var k = 1; k < pool.length; k++) {',
    '    var a = areaOf(pool[k]);',
    '    if (a < bestArea) { best = pool[k]; bestArea = a; }',
    '  }',
    '  return best;',
    '}',

    ...canonicalReportSourceLines(),

    'function run(opts) {',
    '  var mode = opts.mode;',
    '  var report = { count: 0, script_version: "' + SCRIPT_VERSION + '", boxes: [] };',
    '  if (mode !== "off") {',
    '    var coverSelectors = BUILTIN_COVER_SELECTORS.concat(opts.selectors || []);',
    '    var allowSelectors = opts.allow || [];',
    '    var base = document.body || document.documentElement;',
    '    var roots = [];',
    '    if (base) collectShadowRoots(base, roots);',
    '    if (mode === "strict") {',
    '      var textNodesSeen = 0;',
    '      for (var r = 0; r < roots.length; r++) textNodesSeen = markTextHits(roots[r], textNodesSeen);',
    '    }',
    // One selector per target, so descendant rules (" img") never bind to the wrong
    // part of a comma list; allow-listed elements are excluded in CSS too, not
    // only in the report.
    '    var allowSuffix = allowSelectors.length ? ":not(" + allowSelectors.join(", ") + ")" : "";',
    '    var targets = coverSelectors.map(function (s) { return s + allowSuffix; }).concat([HIT_SELECTOR]);',
    '    function each(suffix) { return targets.map(function (t) { return t + suffix; }).join(", "); }',
    '    var css = "";',
    '    css += each("") + " { background: #000 !important; color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }\\n";',
    '    css += each("::placeholder") + " { color: transparent !important; -webkit-text-fill-color: transparent !important; }\\n";',
    '    css += [each(" img"), each(" video"), each(" canvas")].join(", ") + " { visibility: hidden !important; }\\n";',
    '    installStyle(document, css);',
    '    for (var sr = 0; sr < roots.length; sr++) { if (roots[sr] !== base) installStyle(roots[sr], css); }',
    '    var allowSet = new Set();',
    '    for (var a = 0; a < allowSelectors.length; a++) {',
    '      var allowed = findAllDeep(allowSelectors[a]);',
    '      for (var ai = 0; ai < allowed.length; ai++) allowSet.add(allowed[ai]);',
    '    }',
    '    var covered = new Set();',
    '    for (var c = 0; c < coverSelectors.length; c++) {',
    '      var found2 = findAllDeep(coverSelectors[c]);',
    '      for (var fi = 0; fi < found2.length; fi++) { if (!allowSet.has(found2[fi])) covered.add(found2[fi]); }',
    '    }',
    '    var hitEls = findAllDeep(HIT_SELECTOR);',
    '    for (var h = 0; h < hitEls.length; h++) { if (!allowSet.has(hitEls[h])) covered.add(hitEls[h]); }',
    '    var visibleCovered = [];',
    '    covered.forEach(function (el) { if (isVisible(el)) visibleCovered.push(el); });',
    '    var dpr = window.devicePixelRatio || 1;',
    '    var boxes = [];',
    '    for (var v = 0; v < visibleCovered.length && v < MAX_BOXES; v++) {',
    '      var rect2 = visibleCovered[v].getBoundingClientRect();',
    '      boxes.push({ x: Math.round(rect2.x * dpr), y: Math.round(rect2.y * dpr), w: Math.round(rect2.width * dpr), h: Math.round(rect2.height * dpr) });',
    '    }',
    '    report.count = visibleCovered.length;',
    '    report.boxes = boxes;',
    '  }',
    '  if (opts.target_selector || opts.target_text) {',
    '    var target = opts.target_selector ? findTargetBySelector(opts.target_selector) : findTargetByText(opts.target_text);',
    '    if (target) {',
    // instant, not the page's own smooth scroll-behavior, so the rect below
    // reflects where the element actually landed rather than mid-animation.
    '      target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });',
    '      var trect = target.getBoundingClientRect();',
    '      var outside = trect.bottom <= 0 || trect.top >= window.innerHeight || trect.right <= 0 || trect.left >= window.innerWidth;',
    '      if (outside) {',
    '        report.target_error = "target outside the viewport";',
    '      } else {',
    '        report.target = { x: trect.x, y: trect.y, w: trect.width, h: trect.height, vw: window.innerWidth, vh: window.innerHeight, sx: window.scrollX, sy: window.scrollY };',
    '      }',
    '    } else {',
    '      report.target_error = "not found: " + (opts.target_text || opts.target_selector);',
    '    }',
    '  }',
    '  report.nonce = opts.nonce;',
    '  report.sig = computeReportSig(opts.nonce, report.count, report.boxes, report.target, report.target_error);',
    '  return report;',
    '}',

    `window.__opendocs = { version: ${JSON.stringify(SCRIPT_VERSION)}, run: run };`,
  ];
}

/** Strip indentation, blank lines and own-line comments; join into one line. */
function minify(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('//'))
    .join('');
}

/**
 * Build the full installer + call: installs `window.__opendocs` if it is
 * missing or at a different SCRIPT_VERSION, then calls `run(opts)`.
 *
 * @param opts Baked as a JSON literal into the call.
 */
export function buildInstallScript(opts: RunOptions): string {
  const lines = [
    '() => {',
    `if (!window.__opendocs || window.__opendocs.version !== ${JSON.stringify(SCRIPT_VERSION)}) {`,
    ...coreLines(),
    '}',
    `return window.__opendocs.run(${JSON.stringify(opts)});`,
    '}',
  ];
  return minify(lines);
}

/**
 * Build the short one-line call: calls the already-installed `run(opts)`, or
 * returns `{installed: false}` if `window.__opendocs` is missing or stale so
 * the caller knows to fetch {@link buildInstallScript} instead.
 *
 * @param opts Baked as a JSON literal into the call.
 */
export function buildOneLineCall(opts: RunOptions): string {
  return (
    `() => window.__opendocs && window.__opendocs.version === ${JSON.stringify(SCRIPT_VERSION)}` +
    ` ? window.__opendocs.run(${JSON.stringify(opts)}) : {installed: false}`
  );
}
