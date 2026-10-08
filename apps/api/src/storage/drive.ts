import { auth, drive } from '@googleapis/drive';
import type { drive_v3 } from '@googleapis/drive';
import { Readable } from 'node:stream';
import type { Storage, StorageProvider } from './provider';

const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

/**
 * One authenticated Drive client plus the folder its account uploads into. `rootUrl` is for tests
 * only: the generated client honours it per request (not per client), so a stub server needs it
 * passed on every call. Production leaves it undefined (googleapis.com).
 */
export type DriveAccount = { drive: drive_v3.Drive; folderId: string; rootUrl?: string };

const isNotFound = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const { code, response } = error as { code?: unknown; response?: { status?: unknown } };
  if (code === 404 || code === '404') return true;
  return response?.status === 404;
};

export class DriveProvider implements StorageProvider {
  readonly name = 'drive';

  constructor(private readonly accountFor: (account: string) => DriveAccount) {}

  private segment(value: string): string {
    if (!SAFE_SEGMENT.test(value)) throw new Error(`Unsafe storage path segment: ${value}`);
    return value;
  }

  async upload(
    account: string,
    key: string,
    bytes: Uint8Array,
    mime: string,
  ): Promise<{ fileId: string }> {
    const { drive: client, folderId, rootUrl } = this.accountFor(this.segment(account));
    const res = await client.files.create(
      {
        requestBody: { name: key, parents: [folderId] },
        media: { mimeType: mime, body: Readable.from([Buffer.from(bytes)]) },
        fields: 'id',
      },
      { rootUrl },
    );
    const fileId = res.data.id;
    if (!fileId) throw new Error('Drive upload did not return a file id');
    return { fileId };
  }

  async read(account: string, fileId: string): Promise<Uint8Array> {
    const { drive: client, rootUrl } = this.accountFor(this.segment(account));
    const res = await client.files.get(
      { fileId: this.segment(fileId), alt: 'media' },
      { responseType: 'arraybuffer', rootUrl },
    );
    return new Uint8Array(res.data as ArrayBuffer);
  }

  async delete(account: string, fileId: string): Promise<void> {
    const { drive: client, rootUrl } = this.accountFor(this.segment(account));
    try {
      await client.files.delete({ fileId: this.segment(fileId) }, { rootUrl });
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

type DriveAccountConfig = { name: string; refreshToken: string; folderId: string };

const parseAccounts = (raw: string): DriveAccountConfig[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // ponytail: swallow JSON.parse's message, it can quote the raw (secret-bearing) input
    throw new Error('DRIVE_ACCOUNTS is not valid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('DRIVE_ACCOUNTS must be a non-empty JSON array');
  }

  const seen = new Set<string>();
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`DRIVE_ACCOUNTS[${index}] must be an object`);
    }
    const { name, refreshToken, folderId } = entry as Record<string, unknown>;
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(`DRIVE_ACCOUNTS[${index}].name is missing`);
    }
    if (!SAFE_SEGMENT.test(name)) {
      throw new Error(`DRIVE_ACCOUNTS[${index}].name is invalid: ${name}`);
    }
    if (seen.has(name)) {
      throw new Error(`DRIVE_ACCOUNTS[${index}].name is a duplicate: ${name}`);
    }
    if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
      throw new Error(`DRIVE_ACCOUNTS[${index}].refreshToken is missing`);
    }
    if (typeof folderId !== 'string' || folderId.length === 0) {
      throw new Error(`DRIVE_ACCOUNTS[${index}].folderId is missing`);
    }
    seen.add(name);
    return { name, refreshToken, folderId };
  });
};

export const createDriveStorage = (env: EnvVars): Storage => {
  const clientId = required(env, 'DRIVE_CLIENT_ID');
  const clientSecret = required(env, 'DRIVE_CLIENT_SECRET');
  const configs = parseAccounts(required(env, 'DRIVE_ACCOUNTS'));
  const byName = new Map(configs.map((config) => [config.name, config]));

  const clients = new Map<string, DriveAccount>();
  const accountFor = (name: string): DriveAccount => {
    const existing = clients.get(name);
    if (existing) return existing;
    const config = byName.get(name);
    if (!config) throw new Error(`Unknown storage account: ${name}`);
    const oauth = new auth.OAuth2(clientId, clientSecret);
    oauth.setCredentials({ refresh_token: config.refreshToken });
    const client: DriveAccount = {
      drive: drive({ version: 'v3', auth: oauth }),
      folderId: config.folderId,
    };
    clients.set(name, client);
    return client;
  };

  return { provider: new DriveProvider(accountFor), accounts: configs.map((config) => config.name) };
};
