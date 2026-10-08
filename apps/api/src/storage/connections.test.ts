import { expect, test } from 'bun:test';
import type { StorageConnection } from '../../generated/prisma/client';
import {
  accountForConnection,
  encryptDriveSecret,
  encryptS3Secret,
  resolveUploadDestination,
} from './connections';

const connection = (overrides: Partial<StorageConnection> = {}): StorageConnection => ({
  id: 'conn-1',
  organizationId: 'org-1',
  kind: 'gdrive',
  config: { folderId: 'folder-1' },
  secret: encryptDriveSecret({ refreshToken: 'refresh-1' }),
  status: 'untested',
  lastTestedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

test('resolveUploadDestination returns undefined when no kind is active', () => {
  expect(resolveUploadDestination(null, [])).toBeUndefined();
});

test('resolveUploadDestination throws when the active kind has no matching connection', () => {
  expect(() => resolveUploadDestination('s3', [connection({ kind: 'gdrive' })])).toThrow(
    'Active storage kind "s3" has no matching connection',
  );
});

test('resolveUploadDestination throws when the active connection has not passed a test', () => {
  const untested = connection({ status: 'untested' });
  expect(() => resolveUploadDestination('gdrive', [untested])).toThrow(
    'Storage connection "gdrive" is not connected (status: untested)',
  );
});

test('resolveUploadDestination throws when the active connection last failed', () => {
  const failed = connection({ status: 'failed' });
  expect(() => resolveUploadDestination('gdrive', [failed])).toThrow(
    'Storage connection "gdrive" is not connected (status: failed)',
  );
});

test('resolveUploadDestination returns a provider and account for a connected connection', () => {
  const previous = { DRIVE_CLIENT_ID: process.env.DRIVE_CLIENT_ID, DRIVE_CLIENT_SECRET: process.env.DRIVE_CLIENT_SECRET };
  process.env.DRIVE_CLIENT_ID = ['test', 'client', 'id'].join('-');
  process.env.DRIVE_CLIENT_SECRET = ['test', 'client', 'secret'].join('-');
  try {
    const connected = connection({ status: 'connected' });

    const destination = resolveUploadDestination('gdrive', [connected]);

    expect(destination).toBeDefined();
    expect(destination!.provider.name).toBe('drive');
    expect(destination!.account).toBe(accountForConnection(connected));
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('resolveUploadDestination picks the connection matching the active kind among several', () => {
  const gdrive = connection({ id: 'conn-gdrive', kind: 'gdrive', status: 'connected' });
  const s3 = connection({
    id: 'conn-s3',
    kind: 's3',
    config: { bucket: 'my-bucket' },
    secret: encryptS3Secret({ accessKeyId: 'key', secretAccessKey: 'secret' }),
    status: 'connected',
  });

  const destination = resolveUploadDestination('s3', [gdrive, s3]);

  expect(destination!.provider.name).toBe('s3');
  expect(destination!.account).toBe('conn-s3');
});

test('accountForConnection uses the connection row id, so reconnecting never collides with the old account', () => {
  const first = connection({ id: 'conn-a' });
  const second = connection({ id: 'conn-b' });
  expect(accountForConnection(first)).not.toBe(accountForConnection(second));
});
