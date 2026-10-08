import { auth, drive } from '@googleapis/drive';
import { S3Client } from 'bun';
import type { StorageConnection } from '../../generated/prisma/client';
import { DriveProvider, type DriveAccount } from './drive';
import type { StorageProvider } from './provider';
import { S3Provider, type S3Like } from './s3';
import { decryptSecret, encryptSecret } from './secret';

/** Non-secret `StorageConnection.config` shape for a Drive connection. */
export type DriveConfig = { folderId: string };

/** Non-secret `StorageConnection.config` shape for an S3 connection. */
export type S3Config = {
  endpoint?: string;
  region?: string;
  bucket: string;
  /// Accepted and stored, but not yet applied: S3Provider generates its own flat
  /// fileId per upload (see s3.ts), the same way it does for the env-wide provider.
  prefix?: string;
  pathStyle?: boolean;
};

/** Secret payload encrypted into `StorageConnection.secret` for a Drive connection. */
export type DriveSecret = { refreshToken: string };

/** Secret payload encrypted into `StorageConnection.secret` for an S3 connection. */
export type S3Secret = { accessKeyId: string; secretAccessKey: string };

export const encryptDriveSecret = (secret: DriveSecret): string => encryptSecret(JSON.stringify(secret));
export const encryptS3Secret = (secret: S3Secret): string => encryptSecret(JSON.stringify(secret));

const parseDriveSecret = (stored: string): DriveSecret => {
  const parsed = JSON.parse(decryptSecret(stored)) as Partial<DriveSecret>;
  if (!parsed.refreshToken) throw new Error('Stored Drive secret is missing refreshToken');
  return { refreshToken: parsed.refreshToken };
};

const parseS3Secret = (stored: string): S3Secret => {
  const parsed = JSON.parse(decryptSecret(stored)) as Partial<S3Secret>;
  if (!parsed.accessKeyId || !parsed.secretAccessKey) {
    throw new Error('Stored S3 secret is missing accessKeyId or secretAccessKey');
  }
  return { accessKeyId: parsed.accessKeyId, secretAccessKey: parsed.secretAccessKey };
};

/** Narrows a `StorageConnection.config` JSON value to `DriveConfig`, validating the one field it needs. */
const parseDriveConfig = (config: unknown): DriveConfig => {
  if (!config || typeof config !== 'object' || !('folderId' in config) || typeof config.folderId !== 'string') {
    throw new Error('Stored Drive config is missing folderId');
  }
  return { folderId: config.folderId };
};

/** Narrows a `StorageConnection.config` JSON value to `S3Config`, validating the required `bucket`. */
const parseS3Config = (config: unknown): S3Config => {
  if (!config || typeof config !== 'object' || !('bucket' in config) || typeof config.bucket !== 'string') {
    throw new Error('Stored S3 config is missing bucket');
  }
  const endpoint = 'endpoint' in config && typeof config.endpoint === 'string' ? config.endpoint : undefined;
  const region = 'region' in config && typeof config.region === 'string' ? config.region : undefined;
  const prefix = 'prefix' in config && typeof config.prefix === 'string' ? config.prefix : undefined;
  const pathStyle = 'pathStyle' in config && typeof config.pathStyle === 'boolean' ? config.pathStyle : undefined;
  return { bucket: config.bucket, endpoint, region, prefix, pathStyle };
};

/**
 * One account name for a `StorageConnection`-backed provider: the row's own id, so a
 * workspace that reconnects (new row, same kind) never collides with the old
 * connection's stored assets, and `Asset.providerAccount` stays a stable foreign key
 * in spirit even though there is no real foreign key here.
 */
export const accountForConnection = (connection: Pick<StorageConnection, 'id'>): string => connection.id;

/**
 * Builds the `StorageProvider` for one `StorageConnection` row, decrypting its secret
 * only for this call. Reuses `DriveProvider`/`S3Provider` from the existing adapters
 * (no new provider logic) with a single-account closure keyed by `accountForConnection`.
 */
export const providerForConnection = (connection: StorageConnection): StorageProvider => {
  const account = accountForConnection(connection);
  if (connection.kind === 'gdrive') {
    const config = parseDriveConfig(connection.config);
    const { refreshToken } = parseDriveSecret(connection.secret);
    const clientId = process.env.DRIVE_CLIENT_ID;
    const clientSecret = process.env.DRIVE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('DRIVE_CLIENT_ID/DRIVE_CLIENT_SECRET are not set');
    const oauth = new auth.OAuth2(clientId, clientSecret);
    oauth.setCredentials({ refresh_token: refreshToken });
    const driveAccount: DriveAccount = { drive: drive({ version: 'v3', auth: oauth }), folderId: config.folderId };
    return new DriveProvider((requested) => {
      if (requested !== account) throw new Error(`Unknown storage account: ${requested}`);
      return driveAccount;
    });
  }
  if (connection.kind === 's3') {
    const config = parseS3Config(connection.config);
    const { accessKeyId, secretAccessKey } = parseS3Secret(connection.secret);
    const client: S3Like = new S3Client({
      accessKeyId,
      secretAccessKey,
      endpoint: config.endpoint || undefined,
      region: config.region || 'auto',
      bucket: config.bucket,
    });
    return new S3Provider((requested) => {
      if (requested !== account) throw new Error(`Unknown storage account: ${requested}`);
      return client;
    });
  }
  throw new Error(`Unsupported StorageConnection kind: ${connection.kind}`);
};

/**
 * The provider and account an upload should use: the workspace's active, connected
 * `StorageConnection` if one is set, otherwise `undefined` to mean "use OpenDocs
 * storage" (Free, or Pro/Enterprise with nothing active). An active connection that
 * exists but is not `connected` is a configuration error the caller must surface, not
 * swallow — the Contract rules out a silent fallback to OpenDocs storage.
 */
export const resolveUploadDestination = (
  activeKind: string | null,
  connections: StorageConnection[],
  buildProvider: (connection: StorageConnection) => StorageProvider = providerForConnection,
): { provider: StorageProvider; account: string } | undefined => {
  if (!activeKind) return undefined;
  const connection = connections.find((candidate) => candidate.kind === activeKind);
  if (!connection) throw new Error(`Active storage kind "${activeKind}" has no matching connection`);
  if (connection.status !== 'connected') {
    throw new Error(`Storage connection "${activeKind}" is not connected (status: ${connection.status})`);
  }
  return { provider: buildProvider(connection), account: accountForConnection(connection) };
};

/**
 * Round-trips a small probe object through the connection's provider: upload, read
 * back, delete. Used by the connect/test routes — never silently treated as success
 * if any step throws (Contract Decisions: no silent fallback on a storage failure).
 */
export const testConnection = async (
  connection: StorageConnection,
  buildProvider: (connection: StorageConnection) => StorageProvider = providerForConnection,
): Promise<void> => {
  const provider = buildProvider(connection);
  const account = accountForConnection(connection);
  const probe = new TextEncoder().encode(`opendocs-storage-test-${Date.now()}`);
  const { fileId } = await provider.upload(account, 'storage-test', probe, 'text/plain');
  try {
    const read = await provider.read(account, fileId);
    if (read.length !== probe.length) throw new Error('Storage test read returned unexpected bytes');
  } finally {
    await provider.delete(account, fileId).catch(() => {});
  }
};
