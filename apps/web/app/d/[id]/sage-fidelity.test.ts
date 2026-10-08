import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(import.meta.dir, '..', '..', 'globals.css'), 'utf8');

describe('Sage fidelity CSS rules', () => {
  test('Defect 2: frame width follows column, overflow hidden, min-width 0, loupe constrained', () => {
    // .doc-page has overflow-x clip as safeguard
    expect(css).toMatch(/\.doc-page\s*\{[^}]*overflow-x:\s*clip/);

    // .doc-page .frame has overflow hidden and width constraints
    expect(css).toMatch(/\.doc-page \.frame\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.doc-page \.frame\s*\{[^}]*width:\s*100%/);
    expect(css).toMatch(/\.doc-page \.frame\s*\{[^}]*max-width:\s*100%/);
    expect(css).toMatch(/\.doc-page \.frame\s*\{[^}]*min-width:\s*0/);

    // .doc-page .frame-wrap follows column
    expect(css).toMatch(/\.doc-page \.frame-wrap\s*\{[^}]*width:\s*100%/);
    expect(css).toMatch(/\.doc-page \.frame-wrap\s*\{[^}]*max-width:\s*100%/);
    expect(css).toMatch(/\.doc-page \.frame-wrap\s*\{[^}]*min-width:\s*0/);

    // .doc-page .loupe is constrained
    expect(css).toMatch(/\.doc-page \.loupe\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.doc-page \.loupe\s*\{[^}]*max-width:\s*100%/);
    expect(css).toMatch(/\.doc-page \.loupe\s*\{[^}]*min-width:\s*0/);

    // .doc-page .step-content has min-width 0
    expect(css).toMatch(/\.doc-page \.step-content\s*\{[^}]*min-width:\s*0/);
  });

  test('Defect 3: step layout grid with button in col 1 and content in col 2, shrinking below 640px', () => {
    // Desktop step grid: 44px col 1, minmax(0, 1fr) col 2, 18px gap
    expect(css).toMatch(/\.doc-page \.step\s*\{[^}]*grid-template-columns:\s*44px minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/\.doc-page \.step\s*\{[^}]*gap:\s*0 18px/);

    // Step-no in col 1, step-content in col 2
    expect(css).toMatch(/\.doc-page \.step-no\s*\{[^}]*grid-column:\s*1/);
    expect(css).toMatch(/\.doc-page \.step-content\s*\{[^}]*grid-column:\s*2/);

    // Under 640px: 36px button, 12px gap
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.doc-page \.step\s*\{[^}]*grid-template-columns:\s*36px minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.doc-page \.step\s*\{[^}]*gap:\s*0 12px/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.doc-page \.step-circle\s*\{[^}]*width:\s*36px/);
  });

  test('Defect 4: desktop grid shell content 1120px (max-width 1152px with 16px gutters), rail 240px, column gap 48px', () => {
    expect(css).toMatch(/\.doc-page \.page\s*\{[^}]*max-width:\s*1152px/);
    expect(css).toMatch(/\.doc-page \.bar-inner\s*\{[^}]*max-width:\s*1152px/);
    expect(css).toMatch(/\.doc-page \.layout\s*\{[^}]*grid-template-columns:\s*240px minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/\.doc-page \.layout\s*\{[^}]*gap:\s*48px/);
  });

  test('Defect 5: hero h1 and meta left-aligned at shell edge above rail', () => {
    expect(css).toMatch(/\.doc-page \.hero\s*\{[^}]*margin-left:\s*0/);
  });

  test('Defect 6: mobile sticky progress bar below 1024px with single counter', () => {
    // Top bar counter hidden on mobile
    expect(css).toMatch(/@media\s*\(max-width:\s*1023px\)[\s\S]*?\.doc-page \.bar-jump\s*\{[^}]*display:\s*none/);

    // Mobile bar displayed on mobile with 6px meter
    expect(css).toMatch(/@media\s*\(max-width:\s*1023px\)[\s\S]*?\.doc-page \.doc-mobile-bar\s*\{[^}]*display:\s*block/);
    expect(css).toMatch(/@media\s*\(max-width:\s*1023px\)[\s\S]*?\.doc-page \.doc-mobile-bar \.meter\s*\{[^}]*height:\s*6px/);
  });
});
