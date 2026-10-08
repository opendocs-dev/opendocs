import { afterAll, beforeEach, expect, test } from 'bun:test';
import { cleanDatabase, memoryStorage } from '../../test/helpers';
import { getPrisma } from '../db';
import type { Storage } from '../storage/provider';
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

  const provider: Storage = {
    check: async () => {},
    upload: rejects,
    read: rejects,
    delete: async () => {
      calls.push('delete');
      const row = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
      expect(row.deletedAt).toBeNull();
    },
  };

  const result = await sweepExpiredAssets({ storage: provider });

  expect(result).toEqual({ locked: true, deleted: 1, failed: 0 });
  expect(calls).toEqual(['delete']);
  const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
  expect(after.deletedAt).not.toBeNull();
});

test('treats a not-found delete (crash recovery) as success', async () => {
  const org = await createOrg();
  const asset = await createAsset(org.id);

  const provider: Storage = {
    check: async () => {},
    upload: rejects,
    read: rejects,
    delete: async () => {
      const error = new Error('missing') as Error & { code: string };
      error.code = 'ENOENT';
      throw error;
    },
  };

  const result = await sweepExpiredAssets({ storage: provider });

  expect(result).toEqual({ locked: true, deleted: 1, failed: 0 });
  const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
  expect(after.deletedAt).not.toBeNull();
});

test('leaves deletedAt null and continues past a provider 5xx', async () => {
  const org = await createOrg();
  const failing = await createAsset(org.id, { providerFileId: 'failing' });
  const succeeding = await createAsset(org.id, { providerFileId: 'succeeding' });
  const logged: string[] = [];

  const provider: Storage = {
    check: async () => {},
    upload: rejects,
    read: rejects,
    delete: async (fileId) => {
      if (fileId === 'failing') throw new Error('upstream 500');
    },
  };

  const result = await sweepExpiredAssets({
    storage: provider,
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
  const pausedProvider: Storage = {
    check: async () => {},
    upload: rejects,
    read: rejects,
    delete: async () => {
      reachedDelete = true;
      await gate;
    },
  };

  const firstSweep = sweepExpiredAssets({ storage: pausedProvider });
  // Wait until the first sweep holds the lock and is paused inside provider.delete.
  for (let i = 0; i < 200 && !reachedDelete; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(reachedDelete).toBe(true);

  const second = await sweepExpiredAssets({ storage: pausedProvider });
  expect(second).toEqual({ locked: false });

  releaseFirst();
  const first = await firstSweep;
  expect(first).toEqual({ locked: true, deleted: 1, failed: 0 });
});

test('does nothing when no asset is expired', async () => {
  const org = await createOrg();
  await createAsset(org.id, { expiresAt: new Date(Date.now() + 60_000) });

  const provider: Storage = {
    check: async () => {},
    upload: rejects,
    read: rejects,
    delete: rejects,
  };

  const result = await sweepExpiredAssets({ storage: provider });

  expect(result).toEqual({ locked: true, deleted: 0, failed: 0 });
});

test('stops at the time budget and leaves the rest for the next sweep', async () => {
  const org = await createOrg();
  await createAsset(org.id);
  await createAsset(org.id);

  const slowProvider: Storage = {
    check: async () => {},
    upload: rejects,
    read: rejects,
    delete: async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    },
  };

  const result = await sweepExpiredAssets({
    storage: slowProvider,
    budgetMs: 10,
  });

  expect(result).toEqual({ locked: true, deleted: 1, failed: 0 });
});

test('removes the stored object for an expired asset', async () => {
  const storage = memoryStorage();
  const { fileId } = await storage.upload(new Uint8Array([1, 2, 3]), 'image/png');
  const org = await createOrg();
  const asset = await createAsset(org.id, { providerFileId: fileId });

  const result = await sweepExpiredAssets({ storage });

  expect(result).toEqual({ locked: true, deleted: 1, failed: 0 });
  expect(storage.objects.has(fileId)).toBe(false);
  const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
  expect(after.deletedAt).not.toBeNull();
});
