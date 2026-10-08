import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Storage, StorageProvider } from './provider';

const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

/** Development provider: one file per asset at `${root}/${account}/${fileId}`. */
export class LocalDiskProvider implements StorageProvider {
  readonly name = 'local';

  constructor(private readonly root: string) {}

  private path(account: string, fileId: string) {
    // Defense in depth: segments are ours today ('local' + a uuid), never user input.
    for (const segment of [account, fileId]) {
      if (!SAFE_SEGMENT.test(segment)) throw new Error(`Unsafe storage path segment: ${segment}`);
    }
    return join(this.root, account, fileId);
  }

  async upload(account: string, _key: string, bytes: Uint8Array): Promise<{ fileId: string }> {
    const fileId = crypto.randomUUID();
    const path = this.path(account, fileId);
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, bytes);
    return { fileId };
  }

  async read(account: string, fileId: string): Promise<Uint8Array> {
    return new Uint8Array(await Bun.file(this.path(account, fileId)).arrayBuffer());
  }

  async delete(account: string, fileId: string): Promise<void> {
    await rm(this.path(account, fileId), { force: true });
  }
}

export const createLocalStorage = (env: Record<string, string | undefined>): Storage => {
  const dir = env.LOCAL_STORAGE_DIR;
  if (!dir) throw new Error('LOCAL_STORAGE_DIR is not set');
  return { provider: new LocalDiskProvider(dir), accounts: ['local'] };
};
