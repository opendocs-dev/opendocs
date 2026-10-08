/**
 * Plan-based limits removed from @opendocs/core in C23 AC-15. Kept here only until the
 * api plan/billing removal (C23 AC-17); delete this file with it.
 */

/** Free workspace cap on live doc images (100 MiB); compiled docs keep their images permanently */
export const FREE_STORAGE_BYTES = 100 * 1024 * 1024;

/** Daily quotas per workspace plan (D4) */
export const DAILY_QUOTAS = {
  free: {
    files: 200,
    bytes: 200 * 1024 * 1024, // 200 MB = 209_715_200 bytes
  },
  pro: {
    files: 2000,
    bytes: 2 * 1024 * 1024 * 1024, // 2 GB = 2_147_483_648 bytes
  },
  enterprise: {
    files: 10000,
    bytes: 10 * 1024 * 1024 * 1024, // 10 GB = 10_737_418_240 bytes
  },
} as const;

export type Plan = keyof typeof DAILY_QUOTAS;

/** Global upload circuit breaker: 50 GB / day */
export const GLOBAL_BREAKER_BYTES = 50 * 1024 * 1024 * 1024; // 53_687_091_200 bytes

/** Alert threshold ratio for global circuit breaker (80%) */
export const GLOBAL_BREAKER_ALERT_RATIO = 0.8 as const;

/** Alert threshold in bytes: 40 GB (80% of 50 GB) */
export const GLOBAL_BREAKER_ALERT_BYTES = 40 * 1024 * 1024 * 1024; // 42_949_672_960 bytes
