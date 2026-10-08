import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(import.meta.dir, '..', '..', 'globals.css'), 'utf8');

function extractPrintBlock(source: string): string {
  const start = source.indexOf('@media print');
  expect(start).toBeGreaterThan(-1);

  let depth = 0;
  let bodyStart = -1;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') {
      depth++;
      if (depth === 1) bodyStart = i + 1;
    } else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(bodyStart, i);
    }
  }

  throw new Error('unterminated @media print block');
}

function selectorsHidingDisplayNone(printBlock: string): string[] {
  const hidden: string[] = [];
  const ruleRegex = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = ruleRegex.exec(printBlock))) {
    const [, selectorList, body] = match;
    if (/display\s*:\s*none/.test(body)) {
      for (const selector of selectorList.split(',')) {
        hidden.push(selector.trim());
      }
    }
  }

  return hidden;
}

describe('print CSS', () => {
  const printBlock = extractPrintBlock(css);
  const hiddenSelectors = selectorsHidingDisplayNone(printBlock);

  test('never hides the loupe or the full screenshot', () => {
    expect(hiddenSelectors).not.toContain('.doc-page .loupe');
    expect(hiddenSelectors).not.toContain('.doc-page .shot');
    expect(hiddenSelectors).not.toContain('.doc-page .frame');
  });

  test('hides the chrome that should not appear in the PDF', () => {
    expect(hiddenSelectors).toContain('.doc-page .doc-topbar');
    expect(hiddenSelectors).toContain('.doc-page .menu');
    expect(hiddenSelectors).toContain('.doc-page .rail');
    expect(hiddenSelectors).toContain('.doc-page .foot');
    expect(hiddenSelectors).toContain('.doc-page dialog');
  });

  test('tick buttons hidden in print', () => {
    expect(hiddenSelectors).toContain('.doc-page .step-circle');
  });

  test('keeps each step from splitting across a page break', () => {
    expect(printBlock).toMatch(/\.doc-page \.step\s*\{[^}]*break-inside:\s*avoid/);
  });

  test('places the loupe above the screenshot frame in print order', () => {
    expect(printBlock).toMatch(/\.doc-page \.loupe\s*\{[^}]*order:\s*1/);
    expect(printBlock).toMatch(/\.doc-page \.frame\s*\{[^}]*order:\s*2/);
  });
});

function ruleSelectorGroups(source: string): string[] {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const groups: string[] = [];
  const ruleRegex = /([^{}]+)\{[^{}]*\}/g;
  let match: RegExpExecArray | null;

  while ((match = ruleRegex.exec(noComments))) {
    groups.push(match[1]);
  }

  return groups;
}

function classNamesIn(selectorText: string): string[] {
  return Array.from(selectorText.matchAll(/\.([a-zA-Z][\w-]*)/g)).map((m) => m[1]);
}

describe('doc-page class name isolation', () => {
  const groups = ruleSelectorGroups(css);
  const docPageClasses = new Set<string>();
  const bareClasses = new Set<string>();

  for (const group of groups) {
    const isDocPageScoped = group.includes('.doc-page');
    for (const name of classNamesIn(group)) {
      if (name === 'doc-page') continue;
      (isDocPageScoped ? docPageClasses : bareClasses).add(name);
    }
  }

  test('the sticky header uses .doc-topbar, not the dashboard usage-pill .bar', () => {
    expect(docPageClasses.has('doc-topbar')).toBe(true);
    expect(docPageClasses.has('bar')).toBe(false);
  });

  test('no doc-page selector shares a bare class name with a non-doc-page rule', () => {
    const collisions = [...docPageClasses].filter((name) => bareClasses.has(name));
    expect(collisions).toEqual([]);
  });
});
