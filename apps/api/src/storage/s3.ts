import { S3Client } from 'bun';
import type { Env } from '../env';
import type { Storage } from './provider';

/** Structural subset of Bun's S3Client, so tests can inject a fake. */
export type S3Like = {
  file(key: string): {
    write(data: Uint8Array, opts?: { type?: string }): Promise<unknown>;
    arrayBuffer(): Promise<ArrayBuffer>;
  };
  delete(key: string): Promise<void>;
  list(options: { maxKeys: number }): Promise<unknown>;
};

const SAFE_FILE_ID = /^[A-Za-z0-9._-]+$/;

const isNotFound = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const { code, name, message } = error as { code?: unknown; name?: unknown; message?: unknown };
  if (code === 'NoSuchKey') return true;
  const text = `${String(name ?? '')} ${String(message ?? '')}`;
  return /NoSuchKey|404/.test(text);
};

export class S3Storage implements Storage {
  constructor(
    private readonly client: S3Like,
    /** Already normalised: empty, or ends with "/". */
    private readonly prefix = '',
  ) {}

  private key(fileId: string): string {
    // Defense in depth: file ids are ours (a uuid), never user input.
    if (!SAFE_FILE_ID.test(fileId)) throw new Error(`Unsafe storage file id: ${fileId}`);
    return `${this.prefix}${fileId}`;
  }

  async upload(bytes: Uint8Array, mime: string): Promise<{ fileId: string }> {
    const fileId = crypto.randomUUID();
    await this.client.file(this.key(fileId)).write(bytes, { type: mime });
    return { fileId };
  }

  async read(fileId: string): Promise<Uint8Array> {
    return new Uint8Array(await this.client.file(this.key(fileId)).arrayBuffer());
  }

  async delete(fileId: string): Promise<void> {
    try {
      await this.client.delete(this.key(fileId));
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
  }

  async check(): Promise<void> {
    await this.client.list({ maxKeys: 1 });
  }
}

/** Bun S3Client options for the configured bucket; `S3_FORCE_PATH_STYLE=false` means virtual-hosted style. */
export const s3ClientOptions = (s3: Env['s3']) => ({
  accessKeyId: s3.accessKeyId,
  secretAccessKey: s3.secretAccessKey,
  endpoint: s3.endpoint,
  region: s3.region,
  bucket: s3.bucket,
  virtualHostedStyle: !s3.forcePathStyle,
});

export const createS3Storage = (env: Pick<Env, 's3'>, client?: S3Like): Storage =>
  new S3Storage(client ?? new S3Client(s3ClientOptions(env.s3)), env.s3.prefix);
