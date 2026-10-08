/**
 * Formats byte counts as GiB (e.g., "62 GiB", "8.1 GiB", "0.2 GiB", "0 GiB").
 * Matches the UI prototype formatting for tenant storage.
 */
export function formatStorageGiB(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 GiB';
  const GiB = 1024 * 1024 * 1024;
  const val = bytes / GiB;

  // For clean integers or values >= 10 that round cleanly, format without decimal
  if (val >= 10 && Math.round(val * 10) % 10 === 0) {
    return `${Math.round(val)} GiB`;
  }

  return `${val.toFixed(1)} GiB`;
}

/**
 * Formats an ISO date or Date object into "Sep 12, 2026" format.
 */
export function formatTenantDate(isoDateOrDate: string | Date | null | undefined): string {
  if (!isoDateOrDate) return '–';
  const d = typeof isoDateOrDate === 'string' ? new Date(isoDateOrDate) : isoDateOrDate;
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
