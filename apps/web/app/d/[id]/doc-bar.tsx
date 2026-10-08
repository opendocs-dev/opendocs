'use client';

import { useCurrentStep } from './use-current-step';
import { useDismissableMenu } from './use-dismissable-menu';
import { useDoneSteps } from './use-done-steps';
import { RailRows, type RailItem } from './rail';
import { ShareRow } from './share';

type DocBarProps = { title: string; host: string; shareUrl: string; items: RailItem[]; docId?: string };

/**
 * Sticky top bar: source + host, the doc title (fades in once scrolled past
 * the hero), an "x / N" counter that opens the step list as a menu on
 * mobile (the rail is desktop-only), share/PDF actions, and the
 * reading-progress line.
 */
export function DocBar({ title, host, shareUrl, items, docId }: DocBarProps) {
  const { currentIndex, scrolled, progress } = useCurrentStep(items.length);
  const { open, setOpen, containerRef, menuRef } = useDismissableMenu();
  const { doneOrders, doneCount } = useDoneSteps(docId ?? '', items.map((i) => i.order));
  const mark = host.charAt(0).toUpperCase();

  const countText =
    doneCount > 0
      ? `${currentIndex + 1} / ${items.length} · ${doneCount} done`
      : `${currentIndex + 1} / ${items.length}`;

  const donePercent = items.length > 0 ? (doneCount / items.length) * 100 : 0;

  return (
    <header className={`doc-topbar${scrolled ? ' scrolled' : ''}`}>
      <div className="bar-inner">
        <span className="source">
          {mark && <span className="source-mark">{mark}</span>}
          <span className="host">{host}</span>
        </span>
        <span className="bar-title">{title}</span>
        <div className="bar-jump" ref={containerRef}>
          <button type="button" className="bar-count" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
            {countText}
          </button>
          {open && (
            <nav className="menu rail-menu" aria-label="Steps" ref={menuRef}>
              <ol>
                <RailRows items={items} currentIndex={currentIndex} doneOrders={doneOrders} onSelect={() => setOpen(false)} />
              </ol>
            </nav>
          )}
        </div>
        <ShareRow url={shareUrl} title={title} />
      </div>
      <div className="doc-mobile-bar" aria-label="Reading progress">
        <div className="meter" aria-hidden="true">
          <i style={{ width: `${donePercent}%` }} />
        </div>
        <div className="count" aria-live="polite">
          {currentIndex + 1} of {items.length} steps · {doneCount} done
        </div>
      </div>
      <div className="progress">
        <span style={{ width: `${progress * 100}%` }} />
      </div>
    </header>
  );
}
