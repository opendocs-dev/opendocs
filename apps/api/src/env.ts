import { DEFAULT_DRAFT_IMAGE_DAYS, DEFAULT_MAX_STEPS_PER_RUN, MAX_BYTES } from '@opendocs/core';

/** Limits enforced by the api, all from env (C23 AC-14). */
export type Limits = {
  maxStepsPerRun: number;
  maxUploadBytes: number;
  /** Total live step-image bytes per workspace; 0 means no cap. */
  storageQuotaBytes: number;
  draftImageDays: number;
};

export type Env = {
  databaseUrl: string;
  /** Absolute http(s) origin, no trailing slash and no path. */
  publicUrl: string;
  authSecret: string;
  port: number;
  siteName: string;
  /** Lower-cased. */
  adminEmails: string[];
  /** `undefined` means "open until the first user exists" (AC-07). */
  allowSignup: boolean | undefined;
  github: { clientId: string; clientSecret: string } | null;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
    /** Prepended to every object key; `''` when unset. */
    prefix: string;
  };
  /** Public image base (e.g. a CDN or public bucket URL) when set, otherwise images go through the api. */
  assetBaseUrl: string | null;
  limits: Limits;
  ai: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    model: string;
    /** Max questions per chat session per UTC day; 0 = unlimited. */
    dailyMessageLimit: number;
  };
  telegram: { botToken: string; chatId: string } | null;
};

type Source = Record<string, string | undefined>;

export type EnvResult = { ok: true; env: Env } | { ok: false; errors: string[] };

const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
/** `docs` and `/docs/` both become `docs/`; unset stays empty. */
const normalizePrefix = (raw: string | undefined): string => {
  const trimmed = raw?.replace(/^\/+|\/+$/g, '') ?? '';
  return trimmed ? `${trimmed}/` : '';
};

export const DEFAULT_AI_BASE_URL = 'https://api.openai.com/v1';

/**
 * Parses and validates env once. Collects every problem so an operator fixes them in one
 * pass. Vars from earlier versions that this file does not list are never read.
 */
export const parseEnv = (source: Source): EnvResult => {
  const errors: string[] = [];
  const get = (name: string): string | undefined => {
    const value = source[name]?.trim();
    return value ? value : undefined;
  };
  const required = (name: string): string => {
    const value = get(name);
    if (value === undefined) errors.push(`${name} is required`);
    return value ?? '';
  };

  const url = (name: string, value: string | undefined, { origin }: { origin: boolean }): string | undefined => {
    if (value === undefined) return undefined;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      errors.push(`${name} must be an absolute http(s) URL`);
      return undefined;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      errors.push(`${name} must be an absolute http(s) URL`);
      return undefined;
    }
    if (origin && (parsed.pathname !== '/' || parsed.search || parsed.hash)) {
      errors.push(`${name} must not have a path, query or fragment`);
      return undefined;
    }
    return value.replace(/\/+$/, '');
  };

  const bool = (name: string): boolean | undefined => {
    const value = get(name)?.toLowerCase();
    if (value === undefined) return undefined;
    if (value === 'true') return true;
    if (value === 'false') return false;
    errors.push(`${name} must be "true" or "false"`);
    return undefined;
  };

  const int = (name: string, fallback: number, min: number): number => {
    const value = get(name);
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(value) || Number(value) < min || !Number.isSafeInteger(Number(value))) {
      errors.push(`${name} must be an integer >= ${min}`);
      return fallback;
    }
    return Number(value);
  };

  const databaseUrl = required('DATABASE_URL');
  const publicUrl = url('PUBLIC_URL', required('PUBLIC_URL') || undefined, { origin: true }) ?? '';

  const authSecret = required('BETTER_AUTH_SECRET');
  if (authSecret && authSecret.length < 32) errors.push('BETTER_AUTH_SECRET must be at least 32 characters');

  const s3Endpoint = url('S3_ENDPOINT', required('S3_ENDPOINT') || undefined, { origin: false }) ?? '';
  const bucket = required('S3_BUCKET');
  const accessKeyId = required('S3_ACCESS_KEY_ID');
  const secretAccessKey = required('S3_SECRET_ACCESS_KEY');

  const rawAdmins = get('ADMIN_EMAILS');
  let adminEmails: string[] = [];
  if (rawAdmins === undefined) {
    errors.push('ADMIN_EMAILS is required (a comma list of emails)');
  } else {
    const parts = rawAdmins.split(',').map((email) => email.trim()).filter((email) => email.length > 0);
    if (parts.length === 0 || parts.some((email) => !EMAIL.test(email))) {
      errors.push('ADMIN_EMAILS must be a comma list of emails');
    } else {
      adminEmails = parts.map((email) => email.toLowerCase());
    }
  }

  const port = int('PORT', 4000, 1);
  const forcePathStyle = bool('S3_FORCE_PATH_STYLE') ?? false;
  const allowSignup = bool('ALLOW_SIGNUP');

  const githubId = get('GITHUB_CLIENT_ID');
  const githubSecret = get('GITHUB_CLIENT_SECRET');
  if ((githubId === undefined) !== (githubSecret === undefined)) {
    errors.push('GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set together');
  }

  const telegramToken = get('TELEGRAM_BOT_TOKEN');
  const telegramChat = get('TELEGRAM_CHAT_ID');
  if ((telegramToken === undefined) !== (telegramChat === undefined)) {
    errors.push('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set together');
  }

  const limits: Limits = {
    maxStepsPerRun: int('MAX_STEPS_PER_RUN', DEFAULT_MAX_STEPS_PER_RUN, 1),
    maxUploadBytes: int('MAX_UPLOAD_BYTES', MAX_BYTES, 1),
    storageQuotaBytes: int('STORAGE_QUOTA_BYTES', 0, 0),
    draftImageDays: int('DRAFT_IMAGE_DAYS', DEFAULT_DRAFT_IMAGE_DAYS, 1),
  };

  const aiApiKey = get('AI_API_KEY');
  const aiModel = get('AI_MODEL');
  if (aiApiKey !== undefined && aiModel === undefined) errors.push('AI_MODEL is required when AI_API_KEY is set');
  const aiBaseUrl = url('AI_BASE_URL', get('AI_BASE_URL'), { origin: false }) ?? DEFAULT_AI_BASE_URL;
  const aiLimit = int('AI_DAILY_MESSAGE_LIMIT', 10, 0);

  const assetBaseUrl = url('ASSET_BASE_URL', get('ASSET_BASE_URL'), { origin: false }) ?? null;

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    env: {
      databaseUrl,
      publicUrl,
      authSecret,
      port,
      siteName: get('SITE_NAME') ?? 'OpenDocs',
      adminEmails,
      allowSignup,
      github: githubId && githubSecret ? { clientId: githubId, clientSecret: githubSecret } : null,
      s3: {
        endpoint: s3Endpoint,
        region: get('S3_REGION') ?? 'us-east-1',
        bucket,
        accessKeyId,
        secretAccessKey,
        forcePathStyle,
        prefix: normalizePrefix(get('S3_PREFIX')),
      },
      assetBaseUrl,
      limits,
      ai: {
        enabled: aiApiKey !== undefined,
        baseUrl: aiBaseUrl,
        apiKey: aiApiKey ?? '',
        model: aiModel ?? '',
        dailyMessageLimit: aiLimit,
      },
      telegram: telegramToken && telegramChat ? { botToken: telegramToken, chatId: telegramChat } : null,
    },
  };
};

export class EnvError extends Error {
  constructor(readonly errors: string[]) {
    super(`Invalid environment:\n${errors.map((error) => `  - ${error}`).join('\n')}`);
    this.name = 'EnvError';
  }
}

let cached: Env | undefined;

/** The validated env, parsed from `process.env` on first use. Throws {@link EnvError}. */
export const getEnv = (): Env => {
  if (cached) return cached;
  const result = parseEnv(process.env);
  if (!result.ok) throw new EnvError(result.errors);
  cached = result.env;
  return cached;
};

/** The enforced limits (AC-14). */
export const getLimits = (): Limits => getEnv().limits;

/** Test-only: forget the parsed env so the next `getEnv()` re-reads `process.env`. */
export const resetEnvForTest = (): void => {
  cached = undefined;
};
