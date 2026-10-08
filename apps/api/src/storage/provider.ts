import { createDriveStorage } from './drive';
import { createLocalStorage } from './local';
import { createS3Storage } from './s3';

/**
 * Where asset bytes live. Every provider is addressed as (account, fileId) so a
 * multi-account backend needs no call-site changes.
 */
export interface StorageProvider {
  name: string;
  upload(
    account: string,
    key: string,
    bytes: Uint8Array,
    mime: string,
  ): Promise<{ fileId: string }>;
  read(account: string, fileId: string): Promise<Uint8Array>;
  delete(account: string, fileId: string): Promise<void>;
}

/** Round robin over the configured accounts; `counter` is any monotonic number. */
export const pickAccount = (accounts: string[], counter: number): string => {
  if (accounts.length === 0) throw new Error('No storage accounts configured');
  const index = ((counter % accounts.length) + accounts.length) % accounts.length;
  return accounts[index]!;
};

export type Storage = { provider: StorageProvider; accounts: string[] };

type EnvVars = Record<string, string | undefined>;

// Add a store by adding a factory here; nothing else in getStorage() or
// resolveStorageProvider() changes.
const factories: Record<string, (env: EnvVars) => Storage> = {
  local: createLocalStorage,
  s3: createS3Storage,
  drive: createDriveStorage,
};

/**
 * Builds the provider named by STORAGE_PROVIDER. Resolved per call rather than at
 * module load so tests can point LOCAL_STORAGE_DIR at a temp dir.
 */
export const getStorage = (): Storage => {
  const name = process.env.STORAGE_PROVIDER ?? 'local';
  const factory = factories[name];
  if (!factory) throw new Error(`Unsupported STORAGE_PROVIDER: ${name}`);
  return factory(process.env);
};

/**
 * Builds the provider named by `name` (an `Asset.provider` value: `local`, `s3`,
 * `drive`), ignoring `STORAGE_PROVIDER`. Call sites that read or delete existing
 * bytes must resolve per-asset with this instead of `getStorage()`, since a
 * deployment can have assets recorded against more than one provider over time
 * (and will, once workspaces pick their own storage).
 */
export const resolveStorageProvider = (name: string, env: EnvVars = process.env): StorageProvider => {
  const factory = factories[name];
  if (!factory) throw new Error(`Unsupported asset provider: ${name}`);
  return factory(env).provider;
};
