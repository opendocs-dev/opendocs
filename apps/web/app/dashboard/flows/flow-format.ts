import type { FlowItem } from '@/lib/server-api';

/** "Sep 28" style label for a flow's last run (matches UI-A3 mock). */
export function formatFlowDate(lastRunAt: string): string {
  return new Date(lastRunAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/** "Sep 30, 2026" style label for a flow's recorded date (matches UI-A4 mock). */
export function formatRecordedDate(lastRunAt: string | undefined | null): string {
  if (!lastRunAt) return '';
  const d = new Date(lastRunAt);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** "Sep 30, 13:58" style label for a run's timestamp (matches UI-A16 History mock). */
export function formatRunDateTime(dateStr: string | undefined | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const datePart = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const timePart = d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${datePart}, ${timePart}`;
}

/** Whether a flow's "Not redacted" badge should show. */
export function flagsNotRedacted(flow: Pick<FlowItem, 'not_redacted'>): boolean {
  return flow.not_redacted;
}

/**
 * The doc link target, or null when the flow has never been compiled. Only http(s)
 * URLs become links, so a bad value can never turn into a `javascript:` href.
 */
export function docLinkFor(flow: Pick<FlowItem, 'url'>): string | null {
  if (!flow.url) return null;
  try {
    const { protocol } = new URL(flow.url);
    return protocol === 'https:' || protocol === 'http:' ? flow.url : null;
  } catch {
    return null;
  }
}
