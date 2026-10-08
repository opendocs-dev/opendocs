/**
 * Pure math behind the top bar's counter/progress and the rail's
 * done/current/upcoming states. Kept free of the DOM so the geometry can be
 * tested without mounting anything; the client component that reads
 * getBoundingClientRect()/scrollY feeds these.
 */

export type RailState = 'done' | 'current' | 'upcoming';

/**
 * Index of the step currently "in view": the last step whose top is above
 * `threshold` (a fixed fraction of the viewport height), or 0 if none is.
 * Mirrors a simple top-down scan rather than an IntersectionObserver so it
 * can run once per scroll/resize tick with plain numbers.
 */
export function currentStepIndex(tops: number[], threshold: number): number {
  let current = 0;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] < threshold) current = i;
  }
  return current;
}

/** Fraction of the page scrolled, clamped to [0, 1]. */
export function scrollProgress(scrollY: number, scrollHeight: number, viewportHeight: number): number {
  return Math.min(1, Math.max(0, scrollY / Math.max(1, scrollHeight - viewportHeight)));
}

export function railState(index: number, currentIndex: number): RailState {
  if (index === currentIndex) return 'current';
  return 'upcoming';
}
