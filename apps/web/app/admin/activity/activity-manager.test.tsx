import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivityManager } from './activity-manager';
import type { ActivityLogEntry } from '@/lib/server-api';

const sampleLogs: ActivityLogEntry[] = [
  {
    id: 'log-1',
    created_at: new Date().toISOString(),
    actor_kind: 'user',
    actor_id: 'user-1',
    actor_name: 'Juni Yadi',
    actor_email: 'juni@example.com',
    action: 'Changed the site look to Atlas',
    type: 'site',
    detail: {},
  },
  {
    id: 'log-2',
    created_at: new Date().toISOString(),
    actor_kind: 'apikey',
    actor_id: 'key-1',
    actor_name: 'API key',
    action: 'Published guide via agent',
    type: 'guides',
    detail: {},
  },
];

describe('ActivityManager', () => {
  test('renders activity rows with person and action', () => {
    const html = renderToStaticMarkup(
      <ActivityManager initialLogs={sampleLogs} retentionDays={30} canExport={false} />,
    );

    expect(html).toContain('Activity log');
    expect(html).toContain('Last 30 days');
    expect(html).toContain('Juni Yadi');
    expect(html).toContain('Changed the site look to Atlas');
    expect(html).toContain('Published guide via agent');
  });

  test('non-enterprise shows disabled Export CSV with Enterprise badge', () => {
    const html = renderToStaticMarkup(
      <ActivityManager initialLogs={sampleLogs} retentionDays={30} canExport={false} />,
    );

    expect(html).toContain('Export CSV');
    expect(html).toContain('Enterprise');
    expect(html).toContain('disabled');
  });

  test('renders filter bar with bare selects and aria-labels without bulk-bar', () => {
    const html = renderToStaticMarkup(
      <ActivityManager initialLogs={sampleLogs} retentionDays={30} canExport={false} />,
    );

    expect(html).not.toContain('bulk-bar');
    expect(html).toContain('aria-label="Person"');
    expect(html).toContain('aria-label="Type"');
  });

  test('renders external-link icon on Export CSV', () => {
    const html = renderToStaticMarkup(
      <ActivityManager initialLogs={sampleLogs} retentionDays={365} canExport={true} />,
    );

    expect(html).toContain('svg');
    expect(html).toContain('Export CSV');
  });

  test('shows actor email inline and muted next to the name (UI-A20 Finding 3)', () => {
    const html = renderToStaticMarkup(
      <ActivityManager initialLogs={sampleLogs} retentionDays={30} canExport={false} />,
    );

    // Actor email is rendered inline with muted class, not display: block
    expect(html).toContain('<span class="muted" style="margin-left:6px">juni@example.com</span>');
    expect(html).not.toContain('display:block');
    expect(html).not.toContain('display: block');
  });

  test('paging: Load more button is hidden when there is no next page (finding 15)', () => {
    const html = renderToStaticMarkup(
      <ActivityManager
        initialLogs={sampleLogs}
        retentionDays={30}
        canExport={false}
        initialHasMore={false}
      />,
    );

    expect(html).not.toContain('Load more');
  });

  test('paging: Load more button is displayed when initialHasMore is true (finding 15)', () => {
    const html = renderToStaticMarkup(
      <ActivityManager
        initialLogs={sampleLogs}
        retentionDays={30}
        canExport={false}
        initialHasMore={true}
        initialNextCursor="log-2"
      />,
    );

    expect(html).toContain('Load more');
    expect(html).toContain('class="btn"');
    expect(html).toContain('aria-label="Load more activity"');
  });

  test('paging: Load more button auto-displays when 50 items are passed without explicit initialHasMore (finding 15)', () => {
    const fiftyLogs: ActivityLogEntry[] = Array.from({ length: 50 }, (_, i) => ({
      id: `log-${i}`,
      created_at: new Date().toISOString(),
      actor_kind: 'user',
      actor_id: `user-${i}`,
      actor_name: `User ${i}`,
      action: `Action ${i}`,
      type: 'general',
      detail: {},
    }));

    const html = renderToStaticMarkup(
      <ActivityManager
        initialLogs={fiftyLogs}
        retentionDays={30}
        canExport={false}
      />,
    );

    expect(html).toContain('Load more');
    expect(html).toContain('class="btn"');
  });

  test('paging: Load more button is hidden when initialHasMore is explicitly false despite having 50 items (finding 15)', () => {
    const fiftyLogs: ActivityLogEntry[] = Array.from({ length: 50 }, (_, i) => ({
      id: `log-${i}`,
      created_at: new Date().toISOString(),
      actor_kind: 'user',
      actor_id: `user-${i}`,
      actor_name: `User ${i}`,
      action: `Action ${i}`,
      type: 'general',
      detail: {},
    }));

    const html = renderToStaticMarkup(
      <ActivityManager
        initialLogs={fiftyLogs}
        retentionDays={30}
        canExport={false}
        initialHasMore={false}
      />,
    );

    expect(html).not.toContain('Load more');
  });
});
