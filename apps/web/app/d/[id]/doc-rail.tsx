'use client';

import { useCurrentStep } from './use-current-step';
import { useDoneSteps } from './use-done-steps';
import { Rail, type RailItem } from './rail';

type DocRailProps = { items: RailItem[]; docId?: string };

/** Desktop-only sticky rail (see `.rail` display:none below 1024px); tracks the current step via scroll. */
export function DocRail({ items, docId }: DocRailProps) {
  const { currentIndex } = useCurrentStep(items.length);
  const { doneOrders } = useDoneSteps(docId ?? '', items.map((i) => i.order));

  return <Rail items={items} currentIndex={currentIndex} doneOrders={doneOrders} />;
}
