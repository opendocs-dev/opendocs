import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, expect, test } from 'bun:test';
import { BASE_URL, cleanDatabase, signIn, type App } from '../../test/helpers';
import { tinyPng } from '../../test/images';
import { getPrisma } from '../db';
import { createApp } from '../index';
import { getStorage, pickAccount, resolveStorageProvider, type Storage, type StorageProvider } from './provider';
import { LocalDiskProvider } from './local';
import { runProviderContract } from './contract';

const prisma = getPrisma();

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await cleanDatabase();
});

test('single account always selects it', () => {
  for (let counter = 0; counter < 10; counter += 1) {
    expect(pickAccount(['only'], counter)).toBe('only');
  }
});

test('round-robins across 5 accounts', () => {
  const accounts = ['a', 'b', 'c', 'd', 'e'];
  const picked = Array.from({ length: 12 }, (_, counter) => pickAccount(accounts, counter));

  expect(picked).toEqual(['a', 'b', 'c', 'd', 'e', 'a', 'b', 'c', 'd', 'e', 'a', 'b']);
});

runProviderContract('local', async () => {
  const root = await mkdtemp(join(tmpdir(), 'od-provider-contract-'));
  return { provider: new LocalDiskProvider(root), account: 'local' };
});

test('getStorage with an unknown provider throws', () => {
  const previous = process.env.STORAGE_PROVIDER;
  process.env.STORAGE_PROVIDER = 'not-a-real-provider';

  try {
    expect(() => getStorage()).toThrow('Unsupported STORAGE_PROVIDER: not-a-real-provider');
  } finally {
    if (previous === undefined) delete process.env.STORAGE_PROVIDER;
    else process.env.STORAGE_PROVIDER = previous;
  }
});

test('getStorage with STORAGE_PROVIDER=s3 returns the s3 provider', async () => {
  const previous = {
    STORAGE_PROVIDER: process.env.STORAGE_PROVIDER,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_BUCKETS: process.env.S3_BUCKETS,
  };
  process.env.STORAGE_PROVIDER = 's3';
  process.env.S3_ACCESS_KEY_ID = ['test', 'key', 'id'].join('-');
  process.env.S3_SECRET_ACCESS_KEY = ['test', 'secret', 'key'].join('-');
  process.env.S3_BUCKETS = 'bucket-one';

  try {
    const storage = getStorage();
    expect(storage.provider.name).toBe('s3');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('upload failure returns upload_failed with no Asset row', async () => {
  const root = await mkdtemp(join(tmpdir(), 'od-provider-'));
  const disk = new LocalDiskProvider(root);
  const failing: StorageProvider = {
    name: 'failing',
    upload: async () => {
      throw new Error('provider is down');
    },
    read: disk.read.bind(disk),
    delete: disk.delete.bind(disk),
  };
  const storage: Storage = { provider: failing, accounts: ['local'] };

  const app: App = createApp(async () => {}, storage);
  const cookie = await signIn(app);

  const response = await app.handle(
    new Request(`${BASE_URL}/api/v1/assets`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'image/png', 'x-opendocs-kind': 'step' },
      body: tinyPng(),
    }),
  );

  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({
    error: { code: 'upload_failed', message: 'Storage provider rejected the upload' },
  });
  expect(await prisma.asset.count()).toBe(0);
  expect(await prisma.usageDaily.count()).toBe(0);
});

test('resolveStorageProvider returns the provider named by the asset, not STORAGE_PROVIDER', () => {
  const previous = process.env.STORAGE_PROVIDER;
  process.env.STORAGE_PROVIDER = 's3';

  try {
    const provider = resolveStorageProvider('local', {
      ...process.env,
      LOCAL_STORAGE_DIR: '/tmp/od-resolve-storage-provider-test',
    });
    expect(provider.name).toBe('local');
  } finally {
    if (previous === undefined) delete process.env.STORAGE_PROVIDER;
    else process.env.STORAGE_PROVIDER = previous;
  }
});

test('resolveStorageProvider with an unknown provider name throws', () => {
  expect(() => resolveStorageProvider('not-a-real-provider')).toThrow(
    'Unsupported asset provider: not-a-real-provider',
  );
});

test('resolveStorageProvider defaults to process.env when no env is passed', () => {
  const previous = process.env.LOCAL_STORAGE_DIR;
  process.env.LOCAL_STORAGE_DIR = '/tmp/od-resolve-storage-provider-default-env-test';

  try {
    const provider = resolveStorageProvider('local');
    expect(provider.name).toBe('local');
  } finally {
    if (previous === undefined) delete process.env.LOCAL_STORAGE_DIR;
    else process.env.LOCAL_STORAGE_DIR = previous;
  }
});
