import { getEnv } from '../env';
import { createS3Storage } from './s3';

/**
 * Where asset bytes live: one S3-compatible bucket built from env (C23 AC-12). Every
 * object is addressed by the `fileId` returned from `upload`, stored on `Asset.providerFileId`.
 */
export interface Storage {
  upload(bytes: Uint8Array, mime: string): Promise<{ fileId: string }>;
  read(fileId: string): Promise<Uint8Array>;
  /** Deleting an object that is already gone succeeds. */
  delete(fileId: string): Promise<void>;
  /** Cheap reachability check of the bucket; rejects when it cannot be reached. */
  check(): Promise<void>;
}

let storage: Storage | undefined;

/** The deployment's storage, built from env on first use. */
export const getStorage = (): Storage => {
  storage ??= createS3Storage(getEnv());
  return storage;
};

/** Boot check: logs a warning if the bucket is unreachable, never blocks boot. */
export const warnIfStorageUnreachable = async (target: Storage = getStorage()): Promise<void> => {
  try {
    await target.check();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`warning: S3 bucket is not reachable (${message}); uploads will fail until it is`);
  }
};
