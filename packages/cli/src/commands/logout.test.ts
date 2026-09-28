import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readCredentials, saveCredentials } from '../config';
import { logout } from './logout';

let tmp: string;
let file: string;
let out: string[];

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opendocs-logout-'));
  file = path.join(tmp, 'credentials');
  out = [];
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function deps() {
  return { credentialsFile: file, stdout: (line: string) => out.push(line) };
}

test('deletes existing credentials', async () => {
  await saveCredentials(['od', 'live', 'deleteme0000'].join('_'), file);

  const code = await logout([], deps());

  expect(code).toBe(0);
  expect(out.join('')).toBe('Logged out\n');
  expect(await readCredentials(file)).toBe(null);
});

test('idempotent when none exist', async () => {
  const first = await logout([], deps());
  const second = await logout([], deps());

  expect(first).toBe(0);
  expect(second).toBe(0);
  expect(out.join('')).toBe('Not logged in\nNot logged in\n');
});
