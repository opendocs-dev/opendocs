import { S3Client } from 'bun';
import type { Storage, StorageProvider } from './provider';

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Structural subset of Bun's S3Client, so tests can inject a fake. */
export type S3Like = {
  file(key: string): {
    write(data: Uint8Array, opts?: { type?: string }): Promise<unknown>;
    arrayBuffer(): Promise<ArrayBuffer>;
  };
  delete(key: string): Promise<void>;
};

const isNotFound = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const { code, name, message } = error as { code?: unknown; name?: unknown; message?: unknown };
  if (code === 'NoSuchKey') return true;
  const text = `${String(name ?? '')} ${String(message ?? '')}`;
  return /NoSuchKey|404/.test(text);
};

export class S3Provider implements StorageProvider {
  readonly name = 's3';

  constructor(private readonly clientFor: (bucket: string) => S3Like) {}

  private segment(value: string): string {
    if (!SAFE_SEGMENT.test(value)) throw new Error(`Unsafe storage path segment: ${value}`);
    return value;
  }

  async upload(
    account: string,
    _key: string,
    bytes: Uint8Array,
    mime: string,
  ): Promise<{ fileId: string }> {
    const bucket = this.segment(account);
    const fileId = crypto.randomUUID();
    const client = this.clientFor(bucket);
    await client.file(this.segment(fileId)).write(bytes, { type: mime });
    return { fileId };
  }

  async read(account: string, fileId: string): Promise<Uint8Array> {
    const bucket = this.segment(account);
    const client = this.clientFor(bucket);
    return new Uint8Array(await client.file(this.segment(fileId)).arrayBuffer());
  }

  async delete(account: string, fileId: string): Promise<void> {
    const bucket = this.segment(account);
    const client = this.clientFor(bucket);
    try {
      await client.delete(this.segment(fileId));
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
  }
}

type EnvVars = Record<string, string | undefined>;

const required = (env: EnvVars, name: string): string => {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

export const createS3Storage = (env: EnvVars): Storage => {
  const accessKeyId = required(env, 'S3_ACCESS_KEY_ID');
  const secretAccessKey = required(env, 'S3_SECRET_ACCESS_KEY');
  const bucketsRaw = required(env, 'S3_BUCKETS');
  const accounts = bucketsRaw
    .split(',')
    .map((bucket) => bucket.trim())
    .filter((bucket) => bucket.length > 0);
  if (accounts.length === 0) throw new Error('S3_BUCKETS is not set');

  const endpoint = env.S3_ENDPOINT || undefined;
  const region = env.S3_REGION || 'auto';

  const clients = new Map<string, S3Like>();
  const clientFor = (bucket: string): S3Like => {
    const existing = clients.get(bucket);
    if (existing) return existing;
    const client = new S3Client({ accessKeyId, secretAccessKey, endpoint, region, bucket });
    clients.set(bucket, client);
    return client;
  };

  return { provider: new S3Provider(clientFor), accounts };
};
