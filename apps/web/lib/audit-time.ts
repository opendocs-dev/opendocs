import { relativeTime } from './relative-time';

/**
 * Formats a timestamp for audit logs matching prototype UI-A20 / UI-P8:
 * - Today: "Today 14:02"
 * - Yesterday: "Yesterday 16:31"
 * - Older (same year): "Sep 28 15:12"
 * - Older (different year): "Sep 28, 2025 15:12"
 */
export function formatAuditTime(value: string | number | Date, now: Date = new Date()): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'unknown';

  const isSameDay = (d1: Date, d2: Date) =>
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;

  if (isSameDay(d, now)) {
    return `Today ${timeStr}`;
  }

  if (isSameDay(d, yesterday)) {
    return `Yesterday ${timeStr}`;
  }

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthStr = months[d.getMonth()];
  const dateStr = d.getDate();

  if (d.getFullYear() === now.getFullYear()) {
    return `${monthStr} ${dateStr} ${timeStr}`;
  }
  return `${monthStr} ${dateStr}, ${d.getFullYear()} ${timeStr}`;
}

/**
 * Formats "Last active" timestamp matching UI-P8 prototype:
 * - If today: "Today"
 * - Otherwise: relative string like "3 days ago"
 */
export function formatLastActive(
  value: string | number | Date | null | undefined,
  now: Date = new Date(),
): string {
  if (!value) return 'Never';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'unknown';

  const isSameDay = (d1: Date, d2: Date) =>
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();

  if (isSameDay(d, now)) {
    return 'Today';
  }

  return relativeTime(d, now);
}
