import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadAppConfig, requireReport, resolveMode } from './enforce';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opendocs-enforce-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

test('call overrides user and app', () => {
  expect(resolveMode({ call: 'off', user: 'strict', app: 'basic' })).toBe('off');
});

test('user overrides app', () => {
  expect(resolveMode({ user: 'basic', app: 'strict' })).toBe('basic');
});

test('app is the fallback', () => {
  expect(resolveMode({ app: 'basic' })).toBe('basic');
  expect(resolveMode({})).toBe('strict');
});

test('off allows missing report', () => {
  expect(() => requireReport('off', undefined)).not.toThrow();
});

test('strict without report throws', () => {
  expect(() => requireReport('strict', undefined)).toThrow(/redact: "strict"/);
});

test('basic without report throws', () => {
  expect(() => requireReport('basic', undefined)).toThrow(/redact: "basic"/);
});

test('malformed app config falls back with a warning', async () => {
  await mkdir(path.join(tmp, '.opendocs'), { recursive: true });
  await writeFile(path.join(tmp, '.opendocs', 'redact.json'), '{ not json');

  const warnings: string[] = [];
  const config = await loadAppConfig(tmp, (line) => warnings.push(line));

  expect(config).toEqual({});
  expect(warnings.length).toBe(1);
  expect(warnings[0]).toContain('falling back to strict');
});

test('unknown mode string rejected', () => {
  expect(() => resolveMode({ call: 'paranoid' })).toThrow(/unknown redact mode "paranoid"/);
});
