const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

/** "3 hours ago" style label for API-key last-use timestamps. */
export function relativeTime(value: string | number | Date, now: Date = new Date()): string {
  const then = new Date(value).getTime();

  if (Number.isNaN(then)) return 'unknown';

  const diff = then - now.getTime();
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return format.format(Math.round(diff / ms), unit);
  }

  return 'just now';
}
