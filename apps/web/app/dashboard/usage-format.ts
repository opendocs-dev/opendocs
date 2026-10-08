type Plan = keyof typeof DAILY_QUOTAS;

/** Local copy: the plan quota table was removed from @opendocs/core (C23 AC-15); goes with the plan screen (AC-18). */
const DAILY_QUOTAS = {
  free: { files: 200, bytes: 200 * 1024 * 1024 },
  pro: { files: 2000, bytes: 2 * 1024 * 1024 * 1024 },
  enterprise: { files: 10000, bytes: 10 * 1024 * 1024 * 1024 },
} as const;

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** The daily file/byte ceiling for a plan, falling back to Free for an unknown value. */
export function quotaFor(plan: string): { files: number; bytes: number } {
  return plan in DAILY_QUOTAS ? DAILY_QUOTAS[plan as Plan] : DAILY_QUOTAS.free;
}

/** "Free" / "Pro" / "Team" from the lowercase plan id the API returns. */
export function formatPlanName(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

/** "12 / 200 files" or "0 / 10,000 files" style label. */
export function formatFilesUsage(filesLeft: number, filesLimit: number): string {
  const used = filesLimit - filesLeft;

  return `${used.toLocaleString()} / ${filesLimit.toLocaleString()} files`;
}

/** MB below 1 GB, GB (one decimal) at or above 1 GB. */
function formatBytes(bytes: number): string {
  if (bytes < GB) return `${Math.round(bytes / MB)} MB`;

  return `${(bytes / GB).toFixed(1)} GB`;
}

/** "45 MB / 200 MB" or "1.2 GB / 2.0 GB" style label. */
export function formatBytesUsage(bytesLeft: number, bytesLimit: number): string {
  const used = bytesLimit - bytesLeft;

  return `${formatBytes(used)} / ${formatBytes(bytesLimit)}`;
}

/** Usage bar percentage, clamped to 0..100 even if usage exceeds the limit. */
export function usagePercent(left: number, limit: number): number {
  if (limit <= 0) return 0;
  const used = limit - left;

  return Math.max(0, Math.min(100, (used / limit) * 100));
}

/** "62 of 100 MiB on OpenDocs storage (Free)" style label (AC-15, UI-A10 Finding 4 & 6). */
export function formatStorageUsage(
  usedMiB: number,
  limitMiB: number,
  destination: string,
  plan: string,
): string {
  return `${usedMiB.toLocaleString()} of ${limitMiB.toLocaleString()} MiB on ${destination} (${formatPlanName(plan)})`;
}

/** "412 of 10,000 credits (1 credit = 1 reply)" style label (AC-15, UI-A10 Finding 4). */
export function formatAiCreditsUsage(usedCredits: number, totalCredits: number): string {
  return `${usedCredits.toLocaleString()} of ${totalCredits.toLocaleString()} credits (1 credit = 1 reply)`;
}

