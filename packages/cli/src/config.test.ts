import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { credentialsPath, readCredentials, saveCredentials } from './config';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opendocs-config-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

test('Linux/macOS credentials path', () => {
  expect(credentialsPath('linux', { XDG_CONFIG_HOME: '/xdg' }, '/home/u')).toBe(
    path.join('/xdg', 'opendocs', 'credentials')
  );
  expect(credentialsPath('darwin', {}, '/home/u')).toBe(
    path.join('/home/u', '.config', 'opendocs', 'credentials')
  );
});

test('Windows credentials path', () => {
  expect(
    credentialsPath('win32', { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, 'C:\\Users\\u')
  ).toBe('C:\\Users\\u\\AppData\\Roaming\\opendocs\\credentials');
  // APPDATA unset: fall back to the conventional location under the home dir.
  expect(credentialsPath('win32', {}, 'C:\\Users\\u')).toBe(
    'C:\\Users\\u\\AppData\\Roaming\\opendocs\\credentials'
  );
});

test('writes mode 600 on POSIX', async () => {
  const file = path.join(tmp, 'nested', 'credentials');
  // Token-shaped value assembled at runtime so no literal key exists in source.
  const key = ['od', 'test', 'a1b2c3d4'].join('_');

  await saveCredentials(key, file);

  expect(await readCredentials(file)).toBe(key);
  if (process.platform !== 'win32') {
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  }
});

test('atomic write leaves no partial file on interrupt', async () => {
  // Target is a directory, so the final rename fails mid-save.
  const file = path.join(tmp, 'credentials');
  await mkdir(file);
  await writeFile(path.join(file, 'marker'), 'untouched');

  await expect(saveCredentials('never-written', file)).rejects.toThrow();

  // No temp file left behind, and the target is exactly as it was.
  expect(await readdir(tmp)).toEqual(['credentials']);
  expect(await readdir(file)).toEqual(['marker']);
});
