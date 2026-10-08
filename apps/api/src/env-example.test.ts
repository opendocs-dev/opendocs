import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from './env';

const REQUIRED = [
  'DATABASE_URL',
  'PUBLIC_URL',
  'BETTER_AUTH_SECRET',
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'ADMIN_EMAILS',
];

/** Test-only vars: read directly by e2e-login.ts, documented but not part of env.ts. */
const TEST_ONLY = ['E2E_LOGIN_ENABLED', 'E2E_LOGIN_TOKEN'];

const parseExample = (path: string): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) values[match[1]!] = match[2]!;
  }
  return values;
};

/** The names parseEnv actually reads, recorded through a Proxy. */
const keysReadByEnv = (): Set<string> => {
  const read = new Set<string>();
  // Some vars are only read once the required ones are valid, so start from a valid env.
  const base = parseExample(apiExample);
  parseEnv(
    new Proxy(base, {
      get: (target, key) => {
        if (typeof key === 'string') read.add(key);
        return target[key as string];
      },
    }),
  );
  return read;
};

const apiExample = join(import.meta.dir, '..', '.env.example');
const rootExample = join(import.meta.dir, '..', '..', '..', '.env.example');

describe('.env.example', () => {
  test('every env.ts key is documented', () => {
    const documented = parseExample(apiExample);
    for (const key of keysReadByEnv()) expect(Object.keys(documented)).toContain(key);
    for (const key of REQUIRED) expect(Object.keys(documented)).toContain(key);
  });

  test('no unknown keys', () => {
    const known = new Set([...keysReadByEnv(), ...TEST_ONLY]);
    const unknown = Object.keys(parseExample(apiExample)).filter((key) => !known.has(key));
    expect(unknown).toEqual([]);
  });

  test('the example values form a valid env', () => {
    const result = parseEnv(parseExample(apiExample));
    expect(result.ok).toBe(true);
  });

  test('the root copy matches the api copy', () => {
    expect(readFileSync(rootExample, 'utf8')).toBe(readFileSync(apiExample, 'utf8'));
  });

  test('holds no real secrets or domains', () => {
    const text = readFileSync(apiExample, 'utf8');
    expect(text).not.toMatch(/gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}/);
    for (const host of text.match(/https?:\/\/[^\s/]+/g) ?? []) {
      expect(host).toMatch(/localhost|example\.com|api\.openai\.com/);
    }
  });
});
