import { afterAll, describe, expect, test } from 'bun:test';
import { auth, drive } from '@googleapis/drive';
import { runProviderContract } from './contract';
import { createDriveStorage, DriveProvider, type DriveAccount } from './drive';
import { getStorage, pickAccount } from './provider';

const clientId = ['test', 'client', 'id'].join('-');
const clientSecret = ['test', 'client', 'secret'].join('-');
const refreshToken = ['test', 'refresh', 'token'].join('-');

type StoredFile = { name: string; bytes: Uint8Array };

const files = new Map<string, StoredFile>();

const notFound = (): Response =>
  Response.json({ error: { code: 404, message: 'File not found' } }, { status: 404 });

/** Splits a multipart/related body (kept as latin1 so binary parts survive) into its parts. */
const parseMultipart = (body: Uint8Array, boundary: string): { metadata: { name: string }; media: Uint8Array } => {
  const raw = Buffer.from(body).toString('latin1');
  const segments = raw.split(`--${boundary}`);
  const parts: string[] = [];
  for (const segment of segments) {
    const headerEnd = segment.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const content = segment.slice(headerEnd + 4);
    parts.push(content.endsWith('\r\n') ? content.slice(0, -2) : content);
  }
  const metadata = JSON.parse(parts[0]!) as { name: string };
  const media = new Uint8Array(Buffer.from(parts[1]!, 'latin1'));
  return { metadata, media };
};

/** In-memory stand-in for the Drive REST API; the real client is pointed at it via rootUrl. */
const server = Bun.serve({
  port: 0,
  fetch: async (req) => {
    const url = new URL(req.url);

    if (req.method === 'POST' && url.pathname.endsWith('/upload/drive/v3/files')) {
      const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/.exec(req.headers.get('content-type') ?? '');
      const boundary = (boundaryMatch?.[1] ?? boundaryMatch?.[2])?.trim();
      if (!boundary) return new Response('missing boundary', { status: 400 });
      const { metadata, media } = parseMultipart(new Uint8Array(await req.arrayBuffer()), boundary);
      const id = crypto.randomUUID();
      files.set(id, { name: metadata.name, bytes: media });
      return Response.json({ id, name: metadata.name });
    }

    const fileMatch = /\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (fileMatch) {
      const id = fileMatch[1]!;
      if (req.method === 'GET') {
        const stored = files.get(id);
        return stored ? new Response(stored.bytes as BodyInit, { status: 200 }) : notFound();
      }
      if (req.method === 'DELETE') {
        if (!files.has(id)) return notFound();
        files.delete(id);
        return new Response(null, { status: 204 });
      }
    }

    return new Response('not found', { status: 404 });
  },
});

afterAll(() => {
  server.stop();
});

const rootUrl = `http://127.0.0.1:${server.port}/`;

/** A real drive_v3.Drive client authenticated with a short-lived access token, no refresh. */
const makeAccount = (folderId: string): DriveAccount => {
  const oauth = new auth.OAuth2(clientId, clientSecret);
  oauth.setCredentials({
    access_token: ['test', 'access', 'token'].join('-'),
    expiry_date: Date.now() + 3_600_000,
  });
  return { drive: drive({ version: 'v3', auth: oauth }), folderId, rootUrl };
};

runProviderContract('drive', () => ({
  provider: new DriveProvider(() => makeAccount('folder1')),
  account: 'acct1',
}));

describe('createDriveStorage config errors', () => {
  test('missing DRIVE_CLIENT_ID names the variable', () => {
    expect(() => createDriveStorage({})).toThrow('DRIVE_CLIENT_ID is not set');
  });

  test('missing DRIVE_CLIENT_SECRET names the variable', () => {
    expect(() => createDriveStorage({ DRIVE_CLIENT_ID: clientId })).toThrow(
      'DRIVE_CLIENT_SECRET is not set',
    );
  });

  test('missing DRIVE_ACCOUNTS names the variable', () => {
    expect(() =>
      createDriveStorage({ DRIVE_CLIENT_ID: clientId, DRIVE_CLIENT_SECRET: clientSecret }),
    ).toThrow('DRIVE_ACCOUNTS is not set');
  });

  test('invalid JSON throws without echoing the raw value', () => {
    let error: unknown;
    try {
      createDriveStorage({
        DRIVE_CLIENT_ID: clientId,
        DRIVE_CLIENT_SECRET: clientSecret,
        DRIVE_ACCOUNTS: `not json ${refreshToken}`,
      });
    } catch (err) {
      error = err;
    }
    const message = (error as Error).message;
    expect(message).toContain('DRIVE_ACCOUNTS');
    expect(message).not.toContain(refreshToken);
  });

  test('empty array throws', () => {
    expect(() =>
      createDriveStorage({
        DRIVE_CLIENT_ID: clientId,
        DRIVE_CLIENT_SECRET: clientSecret,
        DRIVE_ACCOUNTS: '[]',
      }),
    ).toThrow('DRIVE_ACCOUNTS');
  });

  test('duplicate account name throws without leaking secrets', () => {
    const accounts = JSON.stringify([
      { name: 'staging', refreshToken, folderId: 'folder1' },
      { name: 'staging', refreshToken, folderId: 'folder2' },
    ]);
    let error: unknown;
    try {
      createDriveStorage({
        DRIVE_CLIENT_ID: clientId,
        DRIVE_CLIENT_SECRET: clientSecret,
        DRIVE_ACCOUNTS: accounts,
      });
    } catch (err) {
      error = err;
    }
    const message = (error as Error).message;
    expect(message).toContain('DRIVE_ACCOUNTS');
    expect(message).not.toContain(refreshToken);
  });

  test('missing folderId throws without leaking secrets', () => {
    const accounts = JSON.stringify([{ name: 'staging', refreshToken }]);
    let error: unknown;
    try {
      createDriveStorage({
        DRIVE_CLIENT_ID: clientId,
        DRIVE_CLIENT_SECRET: clientSecret,
        DRIVE_ACCOUNTS: accounts,
      });
    } catch (err) {
      error = err;
    }
    const message = (error as Error).message;
    expect(message).toContain('DRIVE_ACCOUNTS');
    expect(message).not.toContain(refreshToken);
  });
});

describe('getStorage with STORAGE_PROVIDER=drive', () => {
  const keys = ['STORAGE_PROVIDER', 'DRIVE_CLIENT_ID', 'DRIVE_CLIENT_SECRET', 'DRIVE_ACCOUNTS'] as const;
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  afterAll(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  process.env.STORAGE_PROVIDER = 'drive';
  process.env.DRIVE_CLIENT_ID = clientId;
  process.env.DRIVE_CLIENT_SECRET = clientSecret;
  process.env.DRIVE_ACCOUNTS = JSON.stringify([
    { name: 'acct-a', refreshToken: ['test', 'refresh', 'a'].join('-'), folderId: 'folder-a' },
    { name: 'acct-b', refreshToken: ['test', 'refresh', 'b'].join('-'), folderId: 'folder-b' },
  ]);

  test('builds a drive Storage with the configured account names', () => {
    const storage = getStorage();

    expect(storage.provider.name).toBe('drive');
    expect(storage.accounts).toEqual(['acct-a', 'acct-b']);
  });

  test('pickAccount round-robins through the configured accounts', () => {
    const storage = getStorage();

    expect(pickAccount(storage.accounts, 0)).toBe('acct-a');
    expect(pickAccount(storage.accounts, 1)).toBe('acct-b');
    expect(pickAccount(storage.accounts, 2)).toBe('acct-a');
  });
});
