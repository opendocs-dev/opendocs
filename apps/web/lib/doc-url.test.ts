import { afterEach, describe, expect, mock, test } from 'bun:test';

const headerStore = new Map<string, string>();

mock.module('next/headers', () => ({
  headers: async () => ({
    get: (key: string) => headerStore.get(key) ?? null,
  }),
}));

const { absoluteDocUrl, absoluteMetadataUrl } = await import('./doc-url');

const ORIGINAL_ENV = { ...process.env };

function setNodeEnv(value: string): void {
  Object.assign(process.env, { NODE_ENV: value });
}

afterEach(() => {
  headerStore.clear();
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

describe('absoluteDocUrl', () => {
  test('uses PUBLIC_APP_ORIGIN when set, ignoring request headers', async () => {
    process.env.PUBLIC_APP_ORIGIN = 'https://docs.example.com';
    headerStore.set('host', 'evil.test');
    headerStore.set('x-forwarded-proto', 'http');

    expect(await absoluteDocUrl('abc')).toBe('https://docs.example.com/d/abc');
  });

  test('strips a trailing slash from PUBLIC_APP_ORIGIN', async () => {
    process.env.PUBLIC_APP_ORIGIN = 'https://docs.example.com/';

    expect(await absoluteDocUrl('abc')).toBe('https://docs.example.com/d/abc');
  });

  test('falls back to request headers outside production when PUBLIC_APP_ORIGIN is unset', async () => {
    delete process.env.PUBLIC_APP_ORIGIN;
    setNodeEnv('development');
    headerStore.set('host', 'localhost:3000');
    headerStore.set('x-forwarded-proto', 'http');

    expect(await absoluteDocUrl('abc')).toBe('http://localhost:3000/d/abc');
  });

  test('returns a relative URL in production when PUBLIC_APP_ORIGIN is unset', async () => {
    delete process.env.PUBLIC_APP_ORIGIN;
    setNodeEnv('production');
    headerStore.set('host', 'evil.test');
    headerStore.set('x-forwarded-proto', 'http');

    expect(await absoluteDocUrl('abc')).toBe('/d/abc');
  });
});

describe('absoluteMetadataUrl', () => {
  test('uses PUBLIC_APP_ORIGIN when set, ignoring request headers', async () => {
    process.env.PUBLIC_APP_ORIGIN = 'https://docs.example.com';
    headerStore.set('host', 'evil.test');

    expect(await absoluteMetadataUrl('abc')).toBe('https://docs.example.com/d/abc');
  });

  test('falls back to request headers outside production when PUBLIC_APP_ORIGIN is unset', async () => {
    delete process.env.PUBLIC_APP_ORIGIN;
    setNodeEnv('development');
    headerStore.set('host', 'localhost:3000');
    headerStore.set('x-forwarded-proto', 'https');

    expect(await absoluteMetadataUrl('abc')).toBe('https://localhost:3000/d/abc');
  });

  test('returns null in production when PUBLIC_APP_ORIGIN is unset, never trusting headers', async () => {
    delete process.env.PUBLIC_APP_ORIGIN;
    setNodeEnv('production');
    headerStore.set('host', 'evil.test');
    headerStore.set('x-forwarded-proto', 'http');

    expect(await absoluteMetadataUrl('abc')).toBeNull();
  });
});
