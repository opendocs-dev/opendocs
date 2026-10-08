import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { Rail, RailRows, type RailItem } from './rail';

const ITEMS: RailItem[] = [
  { order: 1, label: 'Open cart' },
  { order: 2, label: 'Click checkout' },
  { order: 3, label: 'Confirm payment' },
];

describe('Rail (AC-02)', () => {
  test('renders a labelled nav landmark with a dot and label per step', () => {
    const html = renderToStaticMarkup(<Rail items={ITEMS} currentIndex={0} />);

    expect(html).toContain('aria-label="Steps"');
    expect(html).toContain('<nav');
    expect(html).toContain('Open cart');
    expect(html).toContain('Click checkout');
    expect(html).toContain('Confirm payment');
    expect(html).toContain('href="#step-1"');
  });

  test('meter and count reflect ticks', () => {
    const html = renderToStaticMarkup(<Rail items={ITEMS} currentIndex={0} doneOrders={[1, 2]} />);

    expect(html).toContain('2 of 3 done');
    expect(html).toContain('width:66.66666666666666%');
    expect(html).toContain('Open cart');
    expect(html).toContain('✓');
    expect(html).toContain('class="current done"');
    expect(html).toContain('class="upcoming done"');
    expect(html).toContain('class="upcoming"');
  });

  test('current stripe follows scroll', () => {
    const html1 = renderToStaticMarkup(<Rail items={ITEMS} currentIndex={1} doneOrders={[]} />);
    expect(html1).toContain('aria-current="step"');
    expect(html1).toContain('class="current"');
    expect(html1).toContain('0 of 3 done');

    const html2 = renderToStaticMarkup(<Rail items={ITEMS} currentIndex={2} doneOrders={[]} />);
    expect(html2).toContain('aria-current="step"');
    expect(html2).toContain('class="current"');
  });
});

describe('RailRows', () => {
  test('renders one <li> per item without a wrapping nav/ol', () => {
    const html = renderToStaticMarkup(
      <ol>
        <RailRows items={ITEMS} currentIndex={0} />
      </ol>
    );

    expect(html.match(/<li/g)?.length).toBe(3);
    expect(html).not.toContain('<nav');
  });
});
