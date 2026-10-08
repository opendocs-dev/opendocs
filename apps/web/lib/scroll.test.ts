import { describe, expect, test } from 'bun:test';

import { currentStepIndex, railState, scrollProgress } from './scroll';

describe('currentStepIndex', () => {
  test('picks the last step whose top has crossed the threshold', () => {
    expect(currentStepIndex([-50, 40, 300], 100)).toBe(1);
  });

  test('stays at 0 when no step has crossed the threshold', () => {
    expect(currentStepIndex([200, 400, 600], 100)).toBe(0);
  });

  test('picks the final step once every top has crossed', () => {
    expect(currentStepIndex([-500, -300, -50], 100)).toBe(2);
  });

  test('returns 0 for an empty list', () => {
    expect(currentStepIndex([], 100)).toBe(0);
  });
});

describe('scrollProgress', () => {
  test('0 at the top of the page', () => {
    expect(scrollProgress(0, 2000, 800)).toBe(0);
  });

  test('1 once scrolled to the bottom', () => {
    expect(scrollProgress(1200, 2000, 800)).toBe(1);
  });

  test('clamps above 1 when overscrolled', () => {
    expect(scrollProgress(5000, 2000, 800)).toBe(1);
  });

  test('does not divide by zero when content is shorter than the viewport', () => {
    expect(scrollProgress(0, 400, 800)).toBe(0);
  });
});

describe('railState', () => {
  test('railState no longer returns done', () => {
    expect(railState(0, 2)).toBe('upcoming');
    expect(railState(1, 2)).toBe('upcoming');
  });

  test('current for the matching index', () => {
    expect(railState(2, 2)).toBe('current');
  });

  test('upcoming for indices after the current one', () => {
    expect(railState(3, 2)).toBe('upcoming');
  });
});
