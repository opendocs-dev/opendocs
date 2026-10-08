import { getPrisma } from '../db';
import { resolveStorageProvider, type Storage } from '../storage/provider';

/**
 * Fixed key for the sweep's advisory lock: one sweep at a time across every process
 * sharing this database, regardless of how many API instances are running.
 */
const TTL_SWEEP_LOCK_ID = 842_331_009;

export type SweepOptions = {
  storage?: Storage;
  now?: Date;
  batch?: number;
  /** Stop starting new deletes after this long; the rest waits for the next sweep. */
  budgetMs?: number;
  log?: (message: string) => void;
};

export type SweepResult = { locked: false } | { locked: true; deleted: number; failed: number };

/** ENOENT (crash recovery: file already gone) or a "not found" message both mean the asset is gone. */
const isNotFoundError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === 'ENOENT') return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.toLowerCase().includes('not found');
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Deletes provider bytes for every expired, not-yet-deleted asset and marks each row
 * `deletedAt`. Runs inside one interactive transaction guarded by a Postgres advisory
 * lock, so only one sweep (across every API process) runs at a time; a second sweep
 * that finds the lock held returns immediately instead of racing the first.
 *
 * If the process dies mid-sweep, the transaction rolls back (no `deletedAt` was
 * committed) but the provider deletes already happened; the next sweep's delete then
 * sees "not found" and treats it as success, so state converges without double work.
 */
export const sweepExpiredAssets = async ({
  storage,
  now = new Date(),
  batch = 100,
  budgetMs = 60_000,
  log = (message) => console.error(message),
}: SweepOptions = {}): Promise<SweepResult> => {
  const prisma = getPrisma();

  return prisma.$transaction(
    async (tx): Promise<SweepResult> => {
      const lockRows = await tx.$queryRaw<{ pg_try_advisory_xact_lock: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${TTL_SWEEP_LOCK_ID})
      `;
      if (!lockRows[0]?.pg_try_advisory_xact_lock) {
        return { locked: false };
      }

      let deleted = 0;
      const failedIds: string[] = [];
      // ponytail: one transaction pins one pool connection for the whole sweep; the time
      // budget bounds that (and a failing backlog) to ~1 min per cycle. Move to per-batch
      // transactions + a session lock on a dedicated connection if sweeps grow.
      const deadline = Date.now() + budgetMs;

      while (Date.now() < deadline) {
        const assets = await tx.asset.findMany({
          where: { expiresAt: { lte: now }, deletedAt: null, id: { notIn: failedIds } },
          orderBy: { createdAt: 'asc' },
          take: batch,
          select: { id: true, publicId: true, provider: true, providerAccount: true, providerFileId: true },
        });
        if (assets.length === 0) break;

        for (const asset of assets) {
          if (Date.now() >= deadline) break;
          try {
            // A test-injected storage override always wins (it is simulating a specific
            // provider); otherwise each asset's own recorded provider decides, since a
            // deployment can hold assets from more than one provider over time.
            const provider = storage ? storage.provider : resolveStorageProvider(asset.provider);
            await provider.delete(asset.providerAccount, asset.providerFileId);
          } catch (error) {
            if (!isNotFoundError(error)) {
              failedIds.push(asset.id);
              log(`ttl-sweep: failed to delete asset ${asset.publicId}: ${errorMessage(error)}`);
              continue;
            }
          }

          await tx.asset.update({ where: { id: asset.id }, data: { deletedAt: now } });
          deleted += 1;
        }
      }

      return { locked: true, deleted, failed: failedIds.length };
    },
    // Budget plus headroom for the in-flight delete and the commit.
    { timeout: budgetMs + 60_000, maxWait: 5_000 },
  );
};

/**
 * Starts the recurring sweep: one run ~10s after boot, then every `TTL_SWEEP_MS`
 * (default 5 minutes). Never throws — a failed sweep is logged and the timer keeps
 * going. Returns a function that stops both timers.
 */
export const startTtlJob = (): (() => void) => {
  let running = false;
  const sweep = () => {
    // The advisory lock already makes overlap safe; this just skips a pointless attempt.
    if (running) return;
    running = true;
    sweepExpiredAssets()
      .catch((error) => {
        console.error(`ttl-sweep: sweep failed: ${errorMessage(error)}`);
      })
      .finally(() => {
        running = false;
      });
  };

  // unref: the timers must never be what keeps the process alive.
  const initial = setTimeout(sweep, 10_000);
  initial.unref();
  const interval = setInterval(sweep, Number(process.env.TTL_SWEEP_MS ?? 300_000));
  interval.unref();

  return () => {
    clearTimeout(initial);
    clearInterval(interval);
  };
};
