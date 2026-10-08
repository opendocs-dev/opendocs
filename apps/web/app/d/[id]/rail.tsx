import { railState } from '@/lib/scroll';

export type RailItem = { order: number; label: string };

function stepAnchorId(order: number): string {
  return `step-${order}`;
}

type RailRowsProps = {
  items: RailItem[];
  currentIndex: number;
  doneOrders?: number[];
  onSelect?: (order: number) => void;
};

/**
 * The dot+label rows shared by the desktop rail and the mobile step-jump
 * menu, so both stay in sync without duplicating markup.
 */
export function RailRows({ items, currentIndex, doneOrders = [], onSelect }: RailRowsProps) {
  return (
    <>
      {items.map((item, index) => {
        const isCurrent = index === currentIndex;
        const isDone = doneOrders.includes(item.order);
        const stateClass = railState(index, currentIndex);
        const classes = [stateClass, isDone ? 'done' : ''].filter(Boolean).join(' ');

        return (
          <li key={item.order} className={classes}>
            <a
              href={`#${stepAnchorId(item.order)}`}
              className={isDone ? 'done' : undefined}
              aria-current={isCurrent ? 'step' : undefined}
              onClick={onSelect ? () => onSelect(item.order) : undefined}
            >
              <span className="n dot">{item.order}{isDone ? ' ✓' : ''}</span>
              <span className="label">{item.label}</span>
            </a>
          </li>
        );
      })}
    </>
  );
}

type RailProps = { items: RailItem[]; currentIndex: number; doneOrders?: number[] };

/** Desktop-only sticky left rail (hidden below 1024px via CSS). */
export function Rail({ items, currentIndex, doneOrders = [] }: RailProps) {
  const total = items.length;
  const doneCount = doneOrders.filter((order) => items.some((item) => item.order === order)).length;
  const percent = total > 0 ? (doneCount / total) * 100 : 0;

  return (
    <nav className="rail" aria-label="Steps">
      <h2>Steps</h2>
      <div className="meter" aria-hidden="true">
        <i style={{ width: `${percent}%` }} />
      </div>
      <div className="count" aria-live="polite">
        {doneCount} of {total} done
      </div>
      <ol>
        <RailRows items={items} currentIndex={currentIndex} doneOrders={doneOrders} />
      </ol>
    </nav>
  );
}
