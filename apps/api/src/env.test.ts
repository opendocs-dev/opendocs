import { describe, expect, test } from 'bun:test';
import { parseEnv, type Env } from './env';

/** The smallest env that boots; secrets are built at runtime so nothing key-shaped is committed. */
const minimum = (): Record<string, string> => ({
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  PUBLIC_URL: 'https://docs.example.com',
  BETTER_AUTH_SECRET: ['x', 'y'].join('').repeat(16),
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'bucket',
  S3_ACCESS_KEY_ID: ['access', 'id'].join('-'),
  S3_SECRET_ACCESS_KEY: ['access', 'secret'].join('-'),
  ADMIN_EMAILS: 'Owner@Example.com, second@example.com',
});

const ok = (source: Record<string, string | undefined>): Env => {
  const result = parseEnv(source);
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.env;
};

const errors = (source: Record<string, string | undefined>): string[] => {
  const result = parseEnv(source);
  if (result.ok) throw new Error('expected the env to be rejected');
  return result.errors;
};

describe('parseEnv', () => {
  test('passes with the minimum set', () => {
    const env = ok(minimum());
    expect(env.publicUrl).toBe('https://docs.example.com');
    expect(env.adminEmails).toEqual(['owner@example.com', 'second@example.com']);
  });

  test('applies defaults', () => {
    const env = ok(minimum());
    expect(env.port).toBe(4000);
    expect(env.siteName).toBe('OpenDocs');
    expect(env.s3.region).toBe('us-east-1');
    expect(env.s3.forcePathStyle).toBe(false);
    expect(env.s3.prefix).toBe('');
    expect(env.allowSignup).toBeUndefined();
    expect(env.github).toBeNull();
    expect(env.assetBaseUrl).toBeNull();
    expect(env.telegram).toBeNull();
    expect(env.limits).toEqual({
      maxStepsPerRun: 15,
      maxUploadBytes: 10485760,
      storageQuotaBytes: 0,
      draftImageDays: 7,
    });
    expect(env.ai).toMatchObject({
      enabled: false,
      baseUrl: 'https://api.openai.com/v1',
      dailyMessageLimit: 10,
    });
  });

  test('lists all missing required vars at once', () => {
    const list = errors({});
    for (const name of [
      'DATABASE_URL',
      'PUBLIC_URL',
      'BETTER_AUTH_SECRET',
      'S3_ENDPOINT',
      'S3_BUCKET',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'ADMIN_EMAILS',
    ]) {
      expect(list.some((line) => line.startsWith(`${name} is required`))).toBe(true);
    }
    expect(list).toContain('S3_BUCKET is required');
  });

  test('treats empty values as unset', () => {
    expect(errors({ ...minimum(), S3_BUCKET: '  ' })).toEqual(['S3_BUCKET is required']);
  });

  test('rejects a short secret', () => {
    expect(errors({ ...minimum(), BETTER_AUTH_SECRET: 'short' })).toEqual([
      'BETTER_AUTH_SECRET must be at least 32 characters',
    ]);
  });

  test('rejects half a GitHub pair', () => {
    expect(errors({ ...minimum(), GITHUB_CLIENT_ID: 'id-only' })).toEqual([
      'GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set together',
    ]);
    const env = ok({ ...minimum(), GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret' });
    expect(env.github).toEqual({ clientId: 'id', clientSecret: 'secret' });
  });

  test('rejects half a Telegram pair', () => {
    expect(errors({ ...minimum(), TELEGRAM_CHAT_ID: '1' })).toEqual([
      'TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set together',
    ]);
  });

  test('PUBLIC_URL must be an absolute http(s) origin without a path', () => {
    expect(errors({ ...minimum(), PUBLIC_URL: 'docs.example.com' })).toEqual([
      'PUBLIC_URL must be an absolute http(s) URL',
    ]);
    expect(errors({ ...minimum(), PUBLIC_URL: 'ftp://docs.example.com' })).toEqual([
      'PUBLIC_URL must be an absolute http(s) URL',
    ]);
    expect(errors({ ...minimum(), PUBLIC_URL: 'https://docs.example.com/base' })).toEqual([
      'PUBLIC_URL must not have a path, query or fragment',
    ]);
    expect(ok({ ...minimum(), PUBLIC_URL: 'https://docs.example.com/' }).publicUrl).toBe('https://docs.example.com');
  });

  test('ADMIN_EMAILS must be a comma list of emails', () => {
    expect(errors({ ...minimum(), ADMIN_EMAILS: 'not-an-email' })).toEqual([
      'ADMIN_EMAILS must be a comma list of emails',
    ]);
    expect(errors({ ...minimum(), ADMIN_EMAILS: ' , ' })).toEqual(['ADMIN_EMAILS must be a comma list of emails']);
  });

  test('S3 settings: prefix is normalised and path style is a boolean', () => {
    const env = ok({ ...minimum(), S3_PREFIX: '/docs', S3_FORCE_PATH_STYLE: 'true', S3_REGION: 'auto' });
    expect(env.s3).toMatchObject({ prefix: 'docs/', forcePathStyle: true, region: 'auto' });
    expect(errors({ ...minimum(), S3_FORCE_PATH_STYLE: 'yes' })).toEqual(['S3_FORCE_PATH_STYLE must be "true" or "false"']);
  });

  test('ALLOW_SIGNUP is tri-state', () => {
    expect(ok({ ...minimum(), ALLOW_SIGNUP: 'true' }).allowSignup).toBe(true);
    expect(ok({ ...minimum(), ALLOW_SIGNUP: 'false' }).allowSignup).toBe(false);
    expect(ok({ ...minimum(), ALLOW_SIGNUP: '' }).allowSignup).toBeUndefined();
  });

  test('limits come from env and invalid or negative values are rejected', () => {
    const env = ok({
      ...minimum(),
      MAX_STEPS_PER_RUN: '30',
      MAX_UPLOAD_BYTES: '2048',
      STORAGE_QUOTA_BYTES: '1000000',
      DRAFT_IMAGE_DAYS: '3',
    });
    expect(env.limits).toEqual({ maxStepsPerRun: 30, maxUploadBytes: 2048, storageQuotaBytes: 1000000, draftImageDays: 3 });

    expect(errors({ ...minimum(), MAX_STEPS_PER_RUN: '-1', STORAGE_QUOTA_BYTES: 'lots', MAX_UPLOAD_BYTES: '0' })).toEqual([
      'MAX_STEPS_PER_RUN must be an integer >= 1',
      'MAX_UPLOAD_BYTES must be an integer >= 1',
      'STORAGE_QUOTA_BYTES must be an integer >= 0',
    ]);
  });

  test('AI is on only with a key, and then needs a model', () => {
    expect(ok(minimum()).ai.enabled).toBe(false);
    expect(errors({ ...minimum(), AI_API_KEY: 'k' })).toEqual(['AI_MODEL is required when AI_API_KEY is set']);
    const env = ok({
      ...minimum(),
      AI_API_KEY: 'k',
      AI_MODEL: 'some-model',
      AI_BASE_URL: 'https://ai.example.com/v1/',
      AI_DAILY_MESSAGE_LIMIT: '0',
    });
    expect(env.ai).toEqual({
      enabled: true,
      baseUrl: 'https://ai.example.com/v1',
      apiKey: 'k',
      model: 'some-model',
      dailyMessageLimit: 0,
    });
  });

  test('ignores vars from earlier versions', () => {
    const env = ok({
      ...minimum(),
      STORAGE_PROVIDER: 'local',
      LOCAL_STORAGE_DIR: '/tmp/x',
      S3_BUCKETS: 'a,b',
      BILLING_READY: 'true',
      TENANT_BASE_DOMAIN: 'example.com',
      PLATFORM_ADMIN_EMAILS: 'nobody',
    });
    expect(env.s3.bucket).toBe('bucket');
  });
});
