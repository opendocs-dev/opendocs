/**
 * Builds the source of a self-contained browser-side redaction script.
 *
 * The agent fetches this text via `opendocs_redaction_script`, runs it in the page
 * with its browser tool (`evaluate_script` / `browser_evaluate`), then screenshots.
 * The script has no imports and no references to anything outside itself at
 * runtime: every value (mode, selectors, pattern sources) is baked in as a
 * literal via JSON.stringify, so it can be handed to any browser as plain text.
 */
import {
  CARD_CANDIDATE_PATTERN,
  EMAIL_PATTERN,
  NIK_PATTERN,
  NPWP_PATTERN,
  PHONE_ID_PATTERN,
  TOKEN_PATTERN,
} from '@opendocs/core/redaction';

/** Bumped whenever the emitted script's behavior changes; travels in the report. */
export const SCRIPT_VERSION = '1';

export interface BuildRedactionScriptOptions {
  mode: 'strict' | 'basic';
  selectors?: string[];
  allow?: string[];
}

const BUILTIN_COVER_SELECTORS = [
  'input[type="password"]',
  '[autocomplete^="cc-"]',
  '[autocomplete="one-time-code"]',
  '[data-od-redact]',
];

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
 * Build the source of one zero-argument arrow function `() => { ...; return report; }`.
 *
 * @param options `mode` selects strict (text-content scan + built-ins) or basic
 *   (built-ins only); `selectors`/`allow` add to / subtract from the covered set.
 */
export function buildRedactionScript(options: BuildRedactionScriptOptions): string {
  const coverSelectors = [...BUILTIN_COVER_SELECTORS, ...(options.selectors ?? [])];
  const allowSelectors = options.allow ?? [];
  const patternSources = PATTERN_DEFS.map((def) => def.pattern.source);

  const lines = [
    '() => {',
    `  var MODE = ${JSON.stringify(options.mode)};`,
    `  var SCRIPT_VERSION = ${JSON.stringify(SCRIPT_VERSION)};`,
    `  var COVER_SELECTORS = ${JSON.stringify(coverSelectors)};`,
    `  var ALLOW_SELECTORS = ${JSON.stringify(allowSelectors)};`,
    `  var PATTERN_SOURCES = ${JSON.stringify(patternSources)};`,
    `  var CARD_PATTERN_INDEX = ${JSON.stringify(CARD_PATTERN_INDEX)};`,
    '  var MAX_BOXES = 200;',
    '  var HIT_SELECTOR = "[data-od-redact-hit]";',
    '',
    '  function isLuhnValid(value) {',
    '    var digits = value.replace(/\\D/g, "");',
    '    if (digits.length < 13 || digits.length > 19) return false;',
    '    var sum = 0;',
    '    var alternate = false;',
    '    for (var i = digits.length - 1; i >= 0; i--) {',
    '      var n = parseInt(digits.charAt(i), 10);',
    '      if (isNaN(n)) return false;',
    '      if (alternate) {',
    '        n *= 2;',
    '        if (n > 9) n -= 9;',
    '      }',
    '      sum += n;',
    '      alternate = !alternate;',
    '    }',
    '    return sum % 10 === 0;',
    '  }',
    '',
    '  function textMatchesAnyPattern(text) {',
    '    for (var p = 0; p < PATTERN_SOURCES.length; p++) {',
    '      var re = new RegExp(PATTERN_SOURCES[p], "g");',
    '      var match;',
    '      while ((match = re.exec(text)) !== null) {',
    '        if (p === CARD_PATTERN_INDEX) {',
    '          var digitsOnly = match[0].replace(/\\D/g, "");',
    '          if (!isLuhnValid(digitsOnly)) continue;',
    '        }',
    '        return true;',
    '      }',
    '    }',
    '    return false;',
    '  }',
    '',
    '  var MAX_TEXT_NODES = 50000;',
    '',
    '  function collectShadowRoots(root, out) {',
    '    out.push(root);',
    '    var all = root.querySelectorAll("*");',
    '    for (var i = 0; i < all.length; i++) {',
    '      if (all[i].shadowRoot) collectShadowRoots(all[i].shadowRoot, out);',
    '    }',
    '  }',
    '',
    '  // Every open shadow root gets its own copy of the style: CSS never crosses the shadow',
    '  // boundary, so a document-level rule would report a match as covered while it stays visible.',
    '  var base = document.body || document.documentElement;',
    '  var roots = [];',
    '  if (base) collectShadowRoots(base, roots);',
    '',
    '  var textNodesSeen = 0;',
    '  function markTextHits(root) {',
    '    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);',
    '    var node = walker.nextNode();',
    '    while (node) {',
    '      textNodesSeen++;',
    '      // Fail closed: no report means the CLI refuses the upload, never a partial redaction.',
    '      if (textNodesSeen > MAX_TEXT_NODES) throw new Error("opendocs redaction: page too large to scan; mark sensitive areas with data-od-redact or use redact off");',
    '      var text = node.textContent || "";',
    '      if (text.trim().length > 0 && textMatchesAnyPattern(text)) {',
    '        var parent = node.parentElement;',
    '        if (parent) parent.setAttribute("data-od-redact-hit", "");',
    '      }',
    '      node = walker.nextNode();',
    '    }',
    '  }',
    '',
    '  if (MODE === "strict") {',
    '    for (var r = 0; r < roots.length; r++) markTextHits(roots[r]);',
    '  }',
    '',
    '  // One selector per target, so descendant rules (" img") never bind to the wrong part of a',
    '  // comma list; allow-listed elements are excluded in CSS too, not only in the report.',
    '  var allowSuffix = ALLOW_SELECTORS.length ? ":not(" + ALLOW_SELECTORS.join(", ") + ")" : "";',
    '  var targets = COVER_SELECTORS.map(function (s) { return s + allowSuffix; }).concat([HIT_SELECTOR]);',
    '  function each(suffix) { return targets.map(function (t) { return t + suffix; }).join(", "); }',
    '  var css = "";',
    '  css += each("") + " { background: #000 !important; color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }\\n";',
    '  css += each("::placeholder") + " { color: transparent !important; -webkit-text-fill-color: transparent !important; }\\n";',
    '  css += [each(" img"), each(" video"), each(" canvas")].join(", ") + " { visibility: hidden !important; }\\n";',
    '',
    '  function installStyle(host) {',
    '    var old = host.querySelectorAll("style[data-od-redact]");',
    '    for (var o = 0; o < old.length; o++) old[o].parentNode.removeChild(old[o]);',
    '    var style = document.createElement("style");',
    '    style.setAttribute("data-od-redact", "");',
    '    if (host === document) style.id = "od-redact";',
    '    style.textContent = css;',
    '    (host === document ? (document.head || document.documentElement) : host).appendChild(style);',
    '  }',
    '  installStyle(document);',
    '  for (var sr = 0; sr < roots.length; sr++) {',
    '    if (roots[sr] !== base) installStyle(roots[sr]);',
    '  }',
    '',
    '  function findAllDeep(selector) {',
    '    var results = [];',
    '    function walk(root) {',
    '      var found = root.querySelectorAll(selector);',
    '      for (var i = 0; i < found.length; i++) results.push(found[i]);',
    '      var all = root.querySelectorAll("*");',
    '      for (var j = 0; j < all.length; j++) {',
    '        if (all[j].shadowRoot) walk(all[j].shadowRoot);',
    '      }',
    '    }',
    '    walk(document);',
    '    return results;',
    '  }',
    '',
    '  var allowSet = new Set();',
    '  for (var a = 0; a < ALLOW_SELECTORS.length; a++) {',
    '    var allowed = findAllDeep(ALLOW_SELECTORS[a]);',
    '    for (var ai = 0; ai < allowed.length; ai++) allowSet.add(allowed[ai]);',
    '  }',
    '',
    '  var covered = new Set();',
    '  for (var c = 0; c < COVER_SELECTORS.length; c++) {',
    '    var found2 = findAllDeep(COVER_SELECTORS[c]);',
    '    for (var fi = 0; fi < found2.length; fi++) {',
    '      if (!allowSet.has(found2[fi])) covered.add(found2[fi]);',
    '    }',
    '  }',
    '  var hitEls = findAllDeep(HIT_SELECTOR);',
    '  for (var h = 0; h < hitEls.length; h++) {',
    '    if (!allowSet.has(hitEls[h])) covered.add(hitEls[h]);',
    '  }',
    '',
    '  function isVisible(el) {',
    '    var rect = el.getBoundingClientRect();',
    '    if (rect.width <= 0 || rect.height <= 0) return false;',
    '    var computed = getComputedStyle(el);',
    '    if (computed.visibility === "hidden" || computed.display === "none") return false;',
    '    return true;',
    '  }',
    '',
    '  var visibleCovered = [];',
    '  covered.forEach(function (el) {',
    '    if (isVisible(el)) visibleCovered.push(el);',
    '  });',
    '',
    '  var dpr = window.devicePixelRatio || 1;',
    '  var boxes = [];',
    '  for (var v = 0; v < visibleCovered.length && v < MAX_BOXES; v++) {',
    '    var rect2 = visibleCovered[v].getBoundingClientRect();',
    '    boxes.push({',
    '      x: Math.round(rect2.x * dpr),',
    '      y: Math.round(rect2.y * dpr),',
    '      w: Math.round(rect2.width * dpr),',
    '      h: Math.round(rect2.height * dpr),',
    '    });',
    '  }',
    '',
    '  var report = {',
    '    count: visibleCovered.length,',
    '    script_version: SCRIPT_VERSION,',
    '    boxes: boxes,',
    '  };',
    '',
    '  return report;',
    '}',
  ];

  return lines.join('\n');
}
