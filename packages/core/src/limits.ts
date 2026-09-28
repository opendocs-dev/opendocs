/**
 * Limits, quotas, and shared constants for OpenDocs API v1.
 * Source: Contract - API v1 Foundation (C1-AC01), ADR - Upload and Bandwidth, ADR - Data Model and App Flow.
 */

/** Max upload size in bytes: 10 MB (10 * 1024 * 1024) */
export const MAX_BYTES = 10485760 as const;

/** Max pixel count for decompressed images to guard against decompression bombs (50 Mpx) */
export const MAX_PIXELS = 50000000 as const;

/** Max steps allowed per Run for Free workspaces */
export const FREE_STEPS_PER_RUN = 15 as const;

/** Snap TTL options */
export const SNAP_TTL_VALUES = ['15m', '1h', '24h'] as const;
export type SnapTtl = (typeof SNAP_TTL_VALUES)[number];

export const SNAP_TTL = {
  values: SNAP_TTL_VALUES,
  default: '24h' as const,
  seconds: {
    '15m': 15 * 60,
    '1h': 60 * 60,
    '24h': 24 * 60 * 60,
  } as const,
} as const;

/** Free workspace doc image retention in days */
export const FREE_DOC_IMAGE_DAYS = 30 as const;

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
  team: {
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

/** Base62 public identifier length (16 chars, 96 bits) */
export const PUBLIC_ID_LENGTH = 16 as const;

/** Minimum accepted CLI version (semver) */
export const CLI_MIN_VERSION = '0.1.0' as const;
