import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, expect, test } from 'bun:test';
import { cleanDatabase } from '../../test/helpers';
import { getPrisma } from '../db';
import { LocalDiskProvider } from '../storage/local';
import type { StorageProvider } from '../storage/provider';
import { sweepExpiredAssets } from './ttl';

const prisma = getPrisma();

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await cleanDatabase();
});

const createOrg = async () => {
  const id = crypto.randomUUID();
  return prisma.organization.create({
    data: { id, name: 'ttl-test', slug: `ttl-test-${id.slice(0, 8)}` },
  });
};

type AssetOverrides = Partial<{
  provider: string;
  providerAccount: string;
  expiresAt: Date | null;
  deletedAt: Date | null;
  providerFileId: string;
}>;

const createAsset = async (organizationId: string, overrides: AssetOverrides = {}) =>
  prisma.asset.create({
    data: {
      publicId: crypto.randomUUID(),
      organizationId,
      kind: 'step',
      provider: overrides.provider ?? 'fake',
      providerAccount: overrides.providerAccount ?? 'local',
      providerFileId: overrides.providerFileId ?? crypto.randomUUID(),
      mime: 'image/png',
      bytes: 1,
      width: 1,
      height: 1,
      sha256: 'x'.repeat(64),
      expiresAt: overrides.expiresAt ?? new Date(Date.now() - 1000),
      deletedAt: overrides.deletedAt ?? null,
    },
  });

const rejects = () => Promise.reject(new Error('not implemented'));

test('deletes provider file then sets deletedAt in order', async () => {
  const org = await createOrg();
  const asset = await createAsset(org.id);
  const calls: string[] = [];

  const provider: StorageProvider = {
    name: 'fake',
    upload: rejects,
    read: rejects,
    delete: async () => {
      calls.push('delete');
      const row = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
      expect(row.deletedAt).toBeNull();
    },
  };

  const result = await sweepExpiredAssets({ storage: { provider, accounts: ['local'] } });

  expect(result).toEqual({ locked: true, deleted: 1, failed: 0 });
  expect(calls).toEqual(['delete']);
  const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
  expect(after.deletedAt).not.toBeNull();
});

test('treats a not-found delete (crash recovery) as success', async () => {
  const org = await createOrg();
  const asset = await createAsset(org.id);

  const provider: StorageProvider = {
    name: 'fake',
    upload: rejects,
    read: rejects,
    delete: async () => {
      const error = new Error('missing') as Error & { code: string };
      error.code = 'ENOENT';
      throw error;
    },
  };

  const result = await sweepExpiredAssets({ storage: { provider, accounts: ['local'] } });

  expect(result).toEqual({ locked: true, deleted: 1, failed: 0 });
  const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
  expect(after.deletedAt).not.toBeNull();
});

test('leaves deletedAt null and continues past a provider 5xx', async () => {
  const org = await createOrg();
  const failing = await createAsset(org.id, { providerFileId: 'failing' });
  const succeeding = await createAsset(org.id, { providerFileId: 'succeeding' });
  const logged: string[] = [];

  const provider: StorageProvider = {
    name: 'fake',
    upload: rejects,
    read: rejects,
    delete: async (_account, fileId) => {
      if (fileId === 'failing') throw new Error('upstream 500');
    },
  };

  const result = await sweepExpiredAssets({
    storage: { provider, accounts: ['local'] },
    log: (message) => logged.push(message),
  });

  expect(result).toEqual({ locked: true, deleted: 1, failed: 1 });
  const failedRow = await prisma.asset.findUniqueOrThrow({ where: { id: failing.id } });
  expect(failedRow.deletedAt).toBeNull();
  const succeededRow = await prisma.asset.findUniqueOrThrow({ where: { id: succeeding.id } });
  expect(succeededRow.deletedAt).not.toBeNull();
  expect(logged).toHaveLength(1);
  expect(logged[0]).toContain(failing.publicId);
  expect(logged[0]).toContain('upstream 500');
});

test('holds the advisory lock for the sweep', async () => {
  const org = await createOrg();
  await createAsset(org.id);

  let releaseFirst: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  let reachedDelete = false;
  const pausedProvider: StorageProvider = {
    name: 'fake',
    upload: rejects,
    read: rejects,
    delete: async () => {
      reachedDelete = true;
      await gate;
    },
  };

  const firstSweep = sweepExpiredAssets({ storage: { provider: pausedProvider, accounts: ['local'] } });
  // Wait until the first sweep holds the lock and is paused inside provider.delete.
  for (let i = 0; i < 200 && !reachedDelete; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(reachedDelete).toBe(true);

  const second = await sweepExpiredAssets({ storage: { provider: pausedProvider, accounts: ['local'] } });
  expect(second).toEqual({ locked: false });

  releaseFirst();
  const first = await firstSweep;
  expect(first).toEqual({ locked: true, deleted: 1, failed: 0 });
});

test('does nothing when no asset is expired', async () => {
  const org = await createOrg();
  await createAsset(org.id, { expiresAt: new Date(Date.now() + 60_000) });

  const provider: StorageProvider = {
    name: 'fake',
    upload: rejects,
    read: rejects,
    delete: rejects,
  };

  const result = await sweepExpiredAssets({ storage: { provider, accounts: ['local'] } });

  expect(result).toEqual({ locked: true, deleted: 0, failed: 0 });
});

test('stops at the time budget and leaves the rest for the next sweep', async () => {
  const org = await createOrg();
  await createAsset(org.id);
  await createAsset(org.id);

  const slowProvider: StorageProvider = {
    name: 'fake',
    upload: rejects,
    read: rejects,
    delete: async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    },
  };

  const result = await sweepExpiredAssets({
    storage: { provider: slowProvider, accounts: ['local'] },
    budgetMs: 10,
  });

  expect(result).toEqual({ locked: true, deleted: 1, failed: 0 });
});

test('deletes an asset recorded against "local" even while STORAGE_PROVIDER=s3', async () => {
  // No storage override: the sweep must resolve the provider itself, per asset.
  const previous = {
    STORAGE_PROVIDER: process.env.STORAGE_PROVIDER,
    LOCAL_STORAGE_DIR: process.env.LOCAL_STORAGE_DIR,
  };
  const root = await mkdtemp(join(tmpdir(), 'od-ttl-local-'));

  try {
    process.env.LOCAL_STORAGE_DIR = root;
    const disk = new LocalDiskProvider(root);
    const { fileId } = await disk.upload('local', 'key', new Uint8Array([1, 2, 3]));

    const org = await createOrg();
    const asset = await createAsset(org.id, { provider: 'local', providerAccount: 'local', providerFileId: fileId });

    // Deployment default is s3 with no S3 credentials set, so a fallback to
    // STORAGE_PROVIDER would throw resolving the s3 factory, not just read the
    // wrong bytes.
    process.env.STORAGE_PROVIDER = 's3';

    const result = await sweepExpiredAssets();

    expect(result).toEqual({ locked: true, deleted: 1, failed: 0 });
    const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(after.deletedAt).not.toBeNull();
    await expect(disk.read('local', fileId)).rejects.toBeTruthy();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key as keyof typeof previous];
      else process.env[key as keyof typeof previous] = value;
    }
  }
});
