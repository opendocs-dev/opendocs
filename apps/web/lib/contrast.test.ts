import { describe, expect, test } from 'bun:test';
import { contrastRatio, SAGE_DARK, SAGE_LIGHT } from './contrast';

describe('contrast (AC-01)', () => {
  test('sage light pairs >= 4.5', () => {
    // ink on paper >= 4.5 (contract notes ~14.7)
    const inkOnPaper = contrastRatio(SAGE_LIGHT.ink, SAGE_LIGHT.paper);
    expect(inkOnPaper).toBeGreaterThanOrEqual(4.5);

    // muted on paper >= 4.5 (contract notes ~5.4)
    const mutedOnPaper = contrastRatio(SAGE_LIGHT.muted, SAGE_LIGHT.paper);
    expect(mutedOnPaper).toBeGreaterThanOrEqual(4.5);

    // accent on surface >= 4.5 (contract notes ~6.5)
    const accentOnSurface = contrastRatio(SAGE_LIGHT.accent, SAGE_LIGHT.surface);
    expect(accentOnSurface).toBeGreaterThanOrEqual(4.5);

    // mark-ink on mark >= 4.5 (contract notes ~10.9)
    const markInkOnMark = contrastRatio(SAGE_LIGHT['mark-ink'], SAGE_LIGHT.mark);
    expect(markInkOnMark).toBeGreaterThanOrEqual(4.5);

    // accent-ink on accent >= 4.5
    const accentInkOnAccent = contrastRatio(SAGE_LIGHT['accent-ink'], SAGE_LIGHT.accent);
    expect(accentInkOnAccent).toBeGreaterThanOrEqual(4.5);
  });

  test('sage dark pairs >= 4.5', () => {
    // ink on paper >= 4.5 (contract notes ~16.0)
    const inkOnPaper = contrastRatio(SAGE_DARK.ink, SAGE_DARK.paper);
    expect(inkOnPaper).toBeGreaterThanOrEqual(4.5);

    // muted on paper >= 4.5 (contract notes ~7.9)
    const mutedOnPaper = contrastRatio(SAGE_DARK.muted, SAGE_DARK.paper);
    expect(mutedOnPaper).toBeGreaterThanOrEqual(4.5);

    // accent on surface >= 4.5 (contract notes ~8.1)
    const accentOnSurface = contrastRatio(SAGE_DARK.accent, SAGE_DARK.surface);
    expect(accentOnSurface).toBeGreaterThanOrEqual(4.5);

    // mark-ink on mark >= 4.5 (contract notes ~10.9)
    const markInkOnMark = contrastRatio(SAGE_DARK['mark-ink'], SAGE_DARK.mark);
    expect(markInkOnMark).toBeGreaterThanOrEqual(4.5);

    // accent-ink on accent >= 4.5
    const accentInkOnAccent = contrastRatio(SAGE_DARK['accent-ink'], SAGE_DARK.accent);
    expect(accentInkOnAccent).toBeGreaterThanOrEqual(4.5);
  });
});
