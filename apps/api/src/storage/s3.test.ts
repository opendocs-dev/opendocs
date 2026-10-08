import { expect, test } from 'bun:test';
import { parseEnv } from '../env';
import { assetUrl } from '../asset-url';
import { restoreEnv, setEnv } from '../../test/env';
import { createS3Storage, S3Storage, s3ClientOptions, type S3Like } from './s3';
import { afterEach } from 'bun:test';

afterEach(restoreEnv);

/** In-memory stand-in for Bun's S3Client, keyed by the full object key. */
const makeFakeBucket = () => {
  const objects = new Map<string, Uint8Array>();
  const client: S3Like = {
    file: (key: string) => ({
      write: async (data: Uint8Array) => {
        objects.set(key, data);
        return data.byteLength;
      },
      arrayBuffer: async (): Promise<ArrayBuffer> => {
        const data = objects.get(key);
        if (!data) {
          const error = new Error(`no such key: ${key}`) as Error & { code: string };
          error.code = 'NoSuchKey';
          throw error;
        }
        return new Uint8Array(data).buffer;
      },
    }),
    delete: async (key: string) => {
      objects.delete(key);
    },
    list: async () => [],
  };
  return { client, objects };
};

test('upload then read returns identical bytes', async () => {
  const { client } = makeFakeBucket();
  const storage = new S3Storage(client);
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);

  const { fileId } = await storage.upload(bytes, 'image/png');

  expect(await storage.read(fileId)).toEqual(bytes);
});

test('read of a missing id rejects; delete removes; deleting a missing id resolves', async () => {
  const { client } = makeFakeBucket();
  const storage = new S3Storage(client);

  await expect(storage.read(crypto.randomUUID())).rejects.toBeTruthy();
  const { fileId } = await storage.upload(new Uint8Array([9]), 'image/png');
  await storage.delete(fileId);
  await expect(storage.read(fileId)).rejects.toBeTruthy();
  await expect(storage.delete(crypto.randomUUID())).resolves.toBeUndefined();
});

test('applies prefix', async () => {
  const { client, objects } = makeFakeBucket();
  const storage = new S3Storage(client, 'team/');

  const { fileId } = await storage.upload(new Uint8Array([1]), 'image/png');

  expect([...objects.keys()]).toEqual([`team/${fileId}`]);
  expect(await storage.read(fileId)).toEqual(new Uint8Array([1]));
});

test('rejects an unsafe file id', async () => {
  const storage = new S3Storage(makeFakeBucket().client);
  await expect(storage.read('../secret')).rejects.toThrow('Unsafe storage file id');
});

test('path style flag', () => {
  const base = { endpoint: 'http://localhost:9000', region: 'us-east-1', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's', prefix: '' };
  expect(s3ClientOptions({ ...base, forcePathStyle: true }).virtualHostedStyle).toBe(false);
  expect(s3ClientOptions({ ...base, forcePathStyle: false }).virtualHostedStyle).toBe(true);
  expect(s3ClientOptions({ ...base, forcePathStyle: true })).toMatchObject({ bucket: 'b', endpoint: 'http://localhost:9000' });
});

test('check reaches the bucket and rejects when it cannot', async () => {
  const { client } = makeFakeBucket();
  await expect(new S3Storage(client).check()).resolves.toBeUndefined();
  const broken: S3Like = { ...client, list: async () => { throw new Error('unreachable'); } };
  await expect(new S3Storage(broken).check()).rejects.toThrow('unreachable');
});

test('createS3Storage builds from env', () => {
  const result = parseEnv({
    DATABASE_URL: 'postgresql://u:p@localhost/db',
    PUBLIC_URL: 'http://localhost:3000',
    BETTER_AUTH_SECRET: 'x'.repeat(32),
    S3_ENDPOINT: 'http://localhost:9000',
    S3_BUCKET: 'b',
    S3_ACCESS_KEY_ID: 'a',
    S3_SECRET_ACCESS_KEY: 's',
    S3_PREFIX: 'p',
    ADMIN_EMAILS: 'a@example.com',
  });
  if (!result.ok) throw new Error(result.errors.join());
  const { client, objects } = makeFakeBucket();
  return createS3Storage(result.env, client).upload(new Uint8Array([1]), 'image/png').then(({ fileId }) => {
    expect([...objects.keys()]).toEqual([`p/${fileId}`]);
  });
});

test('uses ASSET_BASE_URL', () => {
  const asset = { publicId: 'pub123', providerFileId: 'file-1' };
  expect(assetUrl(asset)).toBe('http://localhost:3100/api/i/pub123');

  setEnv({ ASSET_BASE_URL: 'https://cdn.example.com/', S3_PREFIX: 'docs' });
  expect(assetUrl(asset)).toBe('https://cdn.example.com/docs/file-1');
});
