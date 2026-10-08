import {
  DAILY_QUOTAS,
  FREE_STORAGE_BYTES,
  GLOBAL_BREAKER_ALERT_BYTES,
  GLOBAL_BREAKER_BYTES,
} from '@opendocs/core';
import { getPrisma } from './db';
import { ApiError } from './errors';
import { getPlan } from './plan';

const quotaExceeded = (message: string) => new ApiError(429, 'quota_exceeded', message);
const breakerOpen = () =>
  new ApiError(429, 'breaker_open', 'Global upload breaker is open for today');
const storageQuotaExceeded = () =>
  new ApiError(
    403,
    'storage_quota_exceeded',
    'Free storage is full (100 MiB): delete a doc or upgrade.',
  );

export const startOfUtcDay = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** A single non-negative integer, matching the header shape `readBody` also accepts. */
const parseContentLength = (header: string | null): number | null =>
  header !== null && /^\d+$/.test(header) ? Number(header) : null;

/** In-flight uploads per workspace. Valid at one API replica; see the note on `acquireSlot`. */
const inFlight = new Map<string, number>();
const MAX_CONCURRENT_UPLOADS = 4;

/**
 * ponytail: this Map lives in process memory, so the limit is per-replica, not global.
 * Correct as long as the API runs as a single replica; move to Postgres/Redis before
 * scaling out, or a busy replica will accept 4 more uploads than intended.
 */
export const acquireSlot = (organizationId: string): void => {
  const current = inFlight.get(organizationId) ?? 0;
  if (current >= MAX_CONCURRENT_UPLOADS) {
    throw quotaExceeded('Too many concurrent uploads for this workspace');
  }
  inFlight.set(organizationId, current + 1);
};

export const releaseSlot = (organizationId: string): void => {
  const current = inFlight.get(organizationId) ?? 0;
  if (current <= 1) inFlight.delete(organizationId);
  else inFlight.set(organizationId, current - 1);
};

/**
 * Global breaker first, then the workspace's own daily file/byte quota. Runs before the
 * body is read, so a request over quota never streams, decodes, or stores anything.
 */
export const checkQuota = async (params: {
  organizationId: string;
  contentLengthHeader: string | null;
  now: Date;
}): Promise<void> => {
  const { organizationId, contentLengthHeader, now } = params;
  const prisma = getPrisma();
  const day = startOfUtcDay(now);

  const globalUsage = await prisma.usageDaily.aggregate({
    where: { day },
    _sum: { bytes: true },
  });
  const globalBytes = globalUsage._sum.bytes ?? 0n;
  if (globalBytes >= BigInt(GLOBAL_BREAKER_BYTES)) throw breakerOpen();

  const plan = await getPlan(organizationId);
  const limit = DAILY_QUOTAS[plan];

  const usage = await prisma.usageDaily.findUnique({
    where: { organizationId_day: { organizationId, day } },
  });
  const files = usage?.files ?? 0;
  const bytes = usage?.bytes ?? 0n;

  // ponytail: read-then-upload is not locked, so up to 4 concurrent uploads (the
  // concurrency cap) can pass on the same count: a workspace may exceed its daily quota
  // by at most 3 files / 4 uploads. Lock the UsageDaily row if that ever matters.
  if (files >= limit.files) throw quotaExceeded('daily file quota reached');
  // Without a content-length (chunked upload) the size is unknown up front, so a
  // workspace already at its byte limit is refused outright.
  if (bytes >= BigInt(limit.bytes)) throw quotaExceeded('daily byte quota reached');

  const contentLength = parseContentLength(contentLengthHeader);
  if (contentLength !== null && bytes + BigInt(contentLength) > BigInt(limit.bytes)) {
    throw quotaExceeded('daily byte quota reached');
  }
};

/**
 * Free workspaces are capped by total live storage rather than a daily quota. Only
 * `kind: 'step'` assets count: snaps are short-lived and excluded regardless of plan,
 * and non-free plans have no storage cap.
 *
 * ponytail: the sum-then-upload check below is not locked, so up to 4 concurrent
 * uploads (the concurrency cap) can pass on the same sum: a Free workspace may
 * overshoot the 100 MiB cap slightly. Add a lock if that ever matters.
 */
export const checkStorageQuota = async (params: {
  organizationId: string;
  incomingBytes: number;
  now: Date;
}): Promise<void> => {
  const { organizationId, incomingBytes, now } = params;
  const plan = await getPlan(organizationId);
  if (plan !== 'free') return;

  const usage = await getPrisma().asset.aggregate({
    where: {
      organizationId,
      kind: 'step',
      deletedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    _sum: { bytes: true },
  });
  const liveBytes = usage._sum.bytes ?? 0;

  if (liveBytes + incomingBytes > FREE_STORAGE_BYTES) throw storageQuotaExceeded();
};

/** One process-lifetime alert per UTC day, keyed by the day's ISO date string. */
const alertedDays = new Set<string>();

/**
 * Re-checks the global sum after a successful upload and sends at most one Telegram
 * alert per UTC day the first time the sum crosses the 80% threshold. The alert
 * fetch is deliberately not awaited: a slow or failing Telegram call must never
 * delay or fail the upload that triggered it.
 */
export const maybeSendBreakerAlert = async (params: {
  now: Date;
  fetchImpl?: typeof fetch;
}): Promise<void> => {
  const { now, fetchImpl = fetch } = params;
  const day = startOfUtcDay(now);
  const dayKey = day.toISOString();
  if (alertedDays.has(dayKey)) return;
  // Claim the day before any await, so two uploads crossing the threshold together
  // cannot both send; released again if the sum turns out to be under it.
  alertedDays.add(dayKey);

  const prisma = getPrisma();
  const globalUsage = await prisma.usageDaily.aggregate({
    where: { day },
    _sum: { bytes: true },
  });
  const globalBytes = globalUsage._sum.bytes ?? 0n;
  if (globalBytes < BigInt(GLOBAL_BREAKER_ALERT_BYTES)) {
    alertedDays.delete(dayKey);
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log('telegram alert skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set');
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const text = `Global upload breaker crossed 80% of ${GLOBAL_BREAKER_BYTES} bytes for ${dayKey}`;

  const logFailure = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    // Never let the bot token reach a log line, even if a runtime error echoes the URL.
    console.error('telegram alert failed', message.split(token).join('<token>'));
  };

  // Never awaited on the response path: a throwing or rejecting fetch must not
  // reach the caller, which is mid-response to a successful upload.
  try {
    Promise.resolve(
      fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      }),
    ).catch(logFailure);
  } catch (error) {
    logFailure(error);
  }
};

/** Test-only: clears in-process state so cases don't leak into each other. */
export const resetQuotaStateForTests = (): void => {
  inFlight.clear();
  alertedDays.clear();
};
