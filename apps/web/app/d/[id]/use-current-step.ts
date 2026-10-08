'use client';

import { useEffect, useState } from 'react';

import { currentStepIndex, scrollProgress } from '@/lib/scroll';

const CURRENT_STEP_THRESHOLD_FRACTION = 0.35;
const SCROLLED_PAST_HERO_PX = 120;

export type StepChromeState = { currentIndex: number; scrolled: boolean; progress: number };

/**
 * Scroll-derived state shared by the top bar and the rail: which step is
 * "current", whether the hero has scrolled past (fades in the bar title),
 * and reading progress. Each caller runs its own listener against the same
 * cheap DOM query rather than sharing state through context.
 */
export function useCurrentStep(stepCount: number): StepChromeState {
  const [state, setState] = useState<StepChromeState>({ currentIndex: 0, scrolled: false, progress: 0 });

  useEffect(() => {
    function update() {
      const items = Array.from(document.querySelectorAll<HTMLElement>('.doc-step'));
      const tops = items.map((item) => item.getBoundingClientRect().top);
      const threshold = window.innerHeight * CURRENT_STEP_THRESHOLD_FRACTION;
      const index = items.length ? currentStepIndex(tops, threshold) : 0;

      const doc = document.documentElement;
      const progress = scrollProgress(window.scrollY, doc.scrollHeight, window.innerHeight);

      setState({ currentIndex: index, scrolled: window.scrollY > SCROLLED_PAST_HERO_PX, progress });
    }

    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);

    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [stepCount]);

  return state;
}
