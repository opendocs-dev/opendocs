import { expect, test } from 'bun:test';
import type { StorageProvider } from './provider';

type ProviderFixture = { provider: StorageProvider; account: string };

/** Shared behaviour every StorageProvider must satisfy; call once per adapter. */
export const runProviderContract = (
  name: string,
  make: () => Promise<ProviderFixture> | ProviderFixture,
): void => {
  test(`${name}: upload then read returns identical bytes`, async () => {
    const { provider, account } = await make();
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);

    const { fileId } = await provider.upload(account, 'key', bytes, 'application/octet-stream');
    const read = await provider.read(account, fileId);

    expect(read).toEqual(bytes);
  });

  test(`${name}: read of a missing id rejects`, async () => {
    const { provider, account } = await make();

    await expect(provider.read(account, crypto.randomUUID())).rejects.toBeTruthy();
  });

  test(`${name}: delete removes (read afterwards rejects)`, async () => {
    const { provider, account } = await make();
    const bytes = new Uint8Array([9, 8, 7]);

    const { fileId } = await provider.upload(account, 'key', bytes, 'application/octet-stream');
    await provider.delete(account, fileId);

    await expect(provider.read(account, fileId)).rejects.toBeTruthy();
  });

  test(`${name}: delete of a missing id resolves (not-found is success)`, async () => {
    const { provider, account } = await make();

    await expect(provider.delete(account, crypto.randomUUID())).resolves.toBeUndefined();
  });
};
