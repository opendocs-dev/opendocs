import { describe, expect, test } from 'bun:test';

import type { DocStep } from '@opendocs/core';

import { tocLabel } from './toc';

function step(partial: Partial<DocStep> & { instruction: string }): DocStep {
  return {
    order: 1,
    action: 'click',
    image: { url: null, expired: false },
    ...partial,
  };
}

describe('tocLabel', () => {
  test('uses the title when present', () => {
    expect(tocLabel(step({ instruction: 'Click the button', title: 'Open cart' }))).toBe(
      'Open cart'
    );
  });

  test('falls back to the instruction when no title', () => {
    expect(tocLabel(step({ instruction: 'Click the button' }))).toBe('Click the button');
  });

  test('strips bold and code markers from the instruction', () => {
    expect(tocLabel(step({ instruction: 'Click **Add to cart** then save `file.pdf`' }))).toBe(
      'Click Add to cart then save file.pdf'
    );
  });

  test('truncates a long label to 60 characters with an ellipsis', () => {
    const long = 'x'.repeat(80);
    const label = tocLabel(step({ instruction: long }));

    expect(label.length).toBe(60);
    expect(label.endsWith('…')).toBe(true);
    expect(label.startsWith('x'.repeat(59))).toBe(true);
  });

  test('leaves a short label untouched', () => {
    const short = 'Short step';
    expect(tocLabel(step({ instruction: short }))).toBe(short);
  });
});
