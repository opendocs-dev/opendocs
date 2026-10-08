/**
 * Limits, quotas, and shared constants for OpenDocs API v1.
 * Source: Contract - API v1 Foundation (C1-AC01), ADR - Upload and Bandwidth, ADR - Data Model and App Flow.
 */

/** Max upload size in bytes: 10 MB (10 * 1024 * 1024) */
export const MAX_BYTES = 10485760 as const;

/** Max pixel count for decompressed images to guard against decompression bombs (50 Mpx) */
export const MAX_PIXELS = 50000000 as const;

/** Documented default for MAX_STEPS_PER_RUN (self-hosted env limit) */
export const DEFAULT_MAX_STEPS_PER_RUN = 15 as const;

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

/** Documented default for DRAFT_IMAGE_DAYS: days a step image lives before its run is compiled, or after a newer compile replaces its run */
export const DEFAULT_DRAFT_IMAGE_DAYS = 7 as const;

/** Base62 public identifier length (16 chars, 96 bits) */
export const PUBLIC_ID_LENGTH = 16 as const;

/** Minimum accepted CLI version (semver). A prerelease sorts below its release, so the alpha needs its own floor. */
export const CLI_MIN_VERSION = '0.1.0-alpha.1' as const;

/** Max length of a step's optional short title (C8-AC01). */
export const STEP_TITLE_MAX = 60 as const;

/** Max length of a step's optional alt text (C8-AC01). */
export const STEP_ALT_MAX = 300 as const;
