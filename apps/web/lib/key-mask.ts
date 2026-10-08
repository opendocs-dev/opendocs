const PLACEHOLDER = '••••••';

/**
 * Renders an API key for lists: only the stored `start` prefix is known
 * server-side, the rest of the key is never persisted in readable form.
 */
export function maskKey(start?: string | null): string {
  if (!start) return PLACEHOLDER;

  return `${start}···`;
}

/**
 * Formats the last-used timestamp in UTC (server and browser must render the same text, or hydration fails) of an API key ("Today", "Sep 24", or "Not connected yet").
 */
export function formatKeyLastUsed(value?: string | null, now: Date = new Date()): string {
  if (!value) return 'Not connected yet';

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'unknown';

  if (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  ) {
    return 'Today';
  }

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
