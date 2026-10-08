import { getPrisma } from './db';
import { getEnv, getLimits } from './env';
import { ApiError } from './errors';

const quotaExceeded = (message: string) => new ApiError(429, 'quota_exceeded', message);

export const startOfUtcDay = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

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

/** Steps already recorded in a run: the next one is refused once it reaches `MAX_STEPS_PER_RUN`. */
export const checkStepLimit = (stepCount: number): void => {
  const { maxStepsPerRun } = getLimits();
  if (stepCount >= maxStepsPerRun) {
    throw new ApiError(422, 'step_limit', `A run is limited to ${maxStepsPerRun} steps`);
  }
};

/**
 * Optional workspace cap on total live step-image bytes (`STORAGE_QUOTA_BYTES`, 0 = no
 * cap). Only `kind: 'step'` assets count: snaps are short-lived.
 *
 * ponytail: the sum-then-upload check is not locked, so up to 4 concurrent uploads (the
 * concurrency cap) can pass on the same sum and overshoot the cap slightly.
 */
export const checkStorageQuota = async (params: {
  organizationId: string;
  incomingBytes: number;
  now: Date;
}): Promise<void> => {
  const { organizationId, incomingBytes, now } = params;
  const { storageQuotaBytes } = getLimits();
  if (storageQuotaBytes === 0) return;

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

  if (liveBytes + incomingBytes > storageQuotaBytes) {
    throw new ApiError(
      403,
      'storage_quota_exceeded',
      `Storage is full (${storageQuotaBytes} bytes): delete a doc to free space.`,
    );
  }
};

/** One process-lifetime alert per UTC day, keyed by the day's ISO date string. */
const alertedDays = new Set<string>();

/**
 * Sends at most one Telegram message per UTC day when an upload is refused for the
 * storage cap, if `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set. Never awaited on
 * the response path: a slow or failing Telegram call must not delay or fail a request.
 */
export const maybeSendQuotaAlert = (params: { now: Date; fetchImpl?: typeof fetch }): void => {
  const { now, fetchImpl = fetch } = params;
  const telegram = getEnv().telegram;
  if (!telegram) return;

  const dayKey = startOfUtcDay(now).toISOString();
  if (alertedDays.has(dayKey)) return;
  alertedDays.add(dayKey);

  const logFailure = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    // Never let the bot token reach a log line, even if a runtime error echoes the URL.
    console.error('telegram alert failed', message.split(telegram.botToken).join('<token>'));
  };

  try {
    Promise.resolve(
      fetchImpl(`https://api.telegram.org/bot${telegram.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: telegram.chatId, text: `Storage quota reached on ${getEnv().siteName} (${dayKey})` }),
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
