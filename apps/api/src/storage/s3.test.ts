import { expect, test } from 'bun:test';
import { pickAccount } from './provider';
import { createS3Storage, S3Provider, type S3Like } from './s3';
import { runProviderContract } from './contract';

/** In-memory stand-in for Bun's S3Client, keyed by object key within one bucket. */
const makeFakeBucket = (): S3Like => {
  const objects = new Map<string, Uint8Array>();

  return {
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
        const copy = new Uint8Array(data);
        return copy.buffer;
      },
    }),
    delete: async (key: string) => {
      objects.delete(key);
    },
  };
};

runProviderContract('s3', () => {
  const fake = makeFakeBucket();
  return { provider: new S3Provider(() => fake), account: 'test-bucket' };
});

const fakeCredentials = () => ({
  S3_ACCESS_KEY_ID: ['test', 'access', 'key'].join('-'),
  S3_SECRET_ACCESS_KEY: ['test', 'secret', 'key'].join('-'),
  S3_BUCKETS: 'bucket-a,bucket-b',
});

test('createS3Storage throws naming S3_ACCESS_KEY_ID when missing', () => {
  const env = fakeCredentials();
  delete (env as Record<string, string | undefined>).S3_ACCESS_KEY_ID;

  expect(() => createS3Storage(env)).toThrow('S3_ACCESS_KEY_ID is not set');
});

test('createS3Storage throws naming S3_SECRET_ACCESS_KEY when missing', () => {
  const env = fakeCredentials();
  delete (env as Record<string, string | undefined>).S3_SECRET_ACCESS_KEY;

  expect(() => createS3Storage(env)).toThrow('S3_SECRET_ACCESS_KEY is not set');
});

test('createS3Storage throws naming S3_BUCKETS when missing', () => {
  const env = fakeCredentials();
  delete (env as Record<string, string | undefined>).S3_BUCKETS;

  expect(() => createS3Storage(env)).toThrow('S3_BUCKETS is not set');
});

test('createS3Storage throws on empty S3_BUCKETS', () => {
  const env = { ...fakeCredentials(), S3_BUCKETS: ' , , ' };

  expect(() => createS3Storage(env)).toThrow('S3_BUCKETS is not set');
});

test('two buckets round-robin through pickAccount', () => {
  const env = fakeCredentials();

  const { accounts } = createS3Storage(env);

  expect(accounts).toEqual(['bucket-a', 'bucket-b']);
  expect(Array.from({ length: 4 }, (_, n) => pickAccount(accounts, n))).toEqual([
    'bucket-a',
    'bucket-b',
    'bucket-a',
    'bucket-b',
  ]);
});
