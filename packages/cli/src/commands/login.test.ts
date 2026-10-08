import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FetchLike } from '../api';
import { readCredentials, saveCredentials } from '../config';
import { login } from './login';

let tmp: string;
let file: string;
let out: string[];
let err: string[];

// Token-shaped values built at runtime: no key literals in the public repo.
const goodKey = ['od', 'live', 'aaaabbbbcccc'].join('_');
const badKey = ['od', 'live', 'revoked00000'].join('_');

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opendocs-login-'));
  file = path.join(tmp, 'credentials');
  out = [];
  err = [];
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function deps(fetchImpl: FetchLike) {
  return {
    fetchImpl,
    credentialsFile: file,
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
  };
}

/** A fetch stub that records the request it saw. */
function stubFetch(
  body: unknown,
  status: number,
  seen: { headers?: Record<string, string>; url?: string } = {}
): FetchLike {
  return async (url, init) => {
    seen.url = url;
    seen.headers = init?.headers;
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
}

test('saves credentials on 200', async () => {
  const seen: { headers?: Record<string, string>; url?: string } = {};
  const me = {
    workspace: { id: 'ws_1', name: 'Acme Docs' },
    quota: { files_left: 10, bytes_left: 1024 },
    min_cli_version: '0.1.0',
  };

  const code = await login(['--key', goodKey], deps(stubFetch(me, 200, seen)));

  expect(code).toBe(0);
  expect(out.join('')).toBe('Logged in to Acme Docs\n');
  expect(await readCredentials(file)).toBe(goodKey);
  expect(seen.url?.endsWith('/me')).toBe(true);
  expect(seen.headers?.['x-api-key']).toBe(goodKey);
  expect(seen.headers?.['x-opendocs-cli-version']).toBeDefined();
});

test('rejects on 401, writes nothing', async () => {
  // An existing key must survive a failed login untouched.
  await saveCredentials(goodKey, file);
  const body = { error: { code: 'unauthorized', message: 'invalid api key' } };

  const code = await login(['--key', badKey], deps(stubFetch(body, 401)));

  expect(code).toBe(1);
  expect(out).toEqual([]);
  expect(err.length).toBe(1);
  expect(err[0]).toMatch(/invalid or has been revoked/);
  expect(await readCredentials(file)).toBe(goodKey);
});

test('prints upgrade hint on 426', async () => {
  const body = {
    error: { code: 'upgrade_required', message: 'CLI 0.1.0 is below the minimum 0.2.0' },
  };

  const code = await login(['--key', goodKey], deps(stubFetch(body, 426)));

  expect(code).toBe(1);
  expect(err.length).toBe(1);
  expect(err[0]).toContain('minimum 0.2.0');
  expect(err[0]!.trimEnd().includes('\n')).toBe(false);
  expect(await readCredentials(file)).toBe(null);
});

test('missing --key is a usage error', async () => {
  const code = await login([], deps(stubFetch({}, 200)));

  expect(code).toBe(1);
  expect(err.join('')).toContain('usage: opendocs login --key <key>');
});
