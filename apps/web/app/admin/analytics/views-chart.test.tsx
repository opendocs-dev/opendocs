import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ViewsChart } from './views-chart';

describe('ViewsChart (UI-A19 Finding 3 & 4)', () => {
  test('renders empty state when data is empty', () => {
    const html = renderToStaticMarkup(<ViewsChart data={[]} />);
    expect(html).toContain('No data for this period');
  });

  test('computes 4 Y-axis ticks on a 1/2/5 step for 300 max (UI-A19 Finding 4)', () => {
    const data = [
      { day: '2026-09-01', views: 120 },
      { day: '2026-09-08', views: 175 },
      { day: '2026-09-15', views: 210 },
      { day: '2026-09-22', views: 246 },
      { day: '2026-09-30', views: 290 },
    ];
    const html = renderToStaticMarkup(<ViewsChart data={data} />);

    // 4 ticks: 0, 100, 200, 300
    expect(html).toContain('>0</text>');
    expect(html).toContain('>100</text>');
    expect(html).toContain('>200</text>');
    expect(html).toContain('>300</text>');
  });

  test('computes 4 Y-axis ticks on a 1/2/5 step for smaller view counts', () => {
    const data = [
      { day: '2026-09-01', views: 10 },
      { day: '2026-09-02', views: 45 },
    ];
    const html = renderToStaticMarkup(<ViewsChart data={data} />);

    // rawMax = 45 -> target = 15 -> step = 20 -> ticks: 0, 20, 40, 60
    expect(html).toContain('>0</text>');
    expect(html).toContain('>20</text>');
    expect(html).toContain('>40</text>');
    expect(html).toContain('>60</text>');
  });

  test('prevents X-axis label collision on 30-day range (UI-A19 Finding 3)', () => {
    // Generate 30 days of data: 2026-09-01 to 2026-09-30
    const data = Array.from({ length: 30 }, (_, i) => {
      const dayNum = String(i + 1).padStart(2, '0');
      return { day: `2026-09-${dayNum}`, views: 10 + i };
    });

    const html = renderToStaticMarkup(<ViewsChart data={data} />);

    // Day 1 (index 0), Day 8 (index 7), Day 15 (index 14), Day 22 (index 21), Day 30 (index 29)
    // Day 29 (index 28) should be dropped because it is closer than 3 points to Day 30 (index 29)
    expect(html).toContain('Sep 1');
    expect(html).toContain('Sep 8');
    expect(html).toContain('Sep 15');
    expect(html).toContain('Sep 22');
    expect(html).toContain('Sep 30');
    expect(html).not.toContain('Sep 29');
  });

  test('renders right-anchored label on the last date', () => {
    const data = [
      { day: '2026-10-01', views: 5 },
      { day: '2026-10-02', views: 10 },
      { day: '2026-10-03', views: 15 },
    ];
    const html = renderToStaticMarkup(<ViewsChart data={data} />);
    expect(html).toContain('text-anchor="end"');
    expect(html).toContain('Oct 3');
  });

  test('applies max height 260px on svg element (UI-A19 Finding 8)', () => {
    const data = [{ day: '2026-10-01', views: 5 }];
    const html = renderToStaticMarkup(<ViewsChart data={data} />);
    expect(html).toContain('max-height:260px');
  });
});
