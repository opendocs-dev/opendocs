'use client';

import { useDoneSteps } from './use-done-steps';

type StepTickProps = {
  order: number;
  docId?: string;
};

export function StepTick({ order, docId }: StepTickProps) {
  const { isDone, toggle } = useDoneSteps(docId ?? '');
  const done = isDone(order);

  return (
    <button
      type="button"
      className="step-circle"
      aria-pressed={done}
      aria-label={`Mark step ${order} as done`}
      onClick={() => toggle(order)}
    >
      {done ? '✓' : order}
    </button>
  );
}
