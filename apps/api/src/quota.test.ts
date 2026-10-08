import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { BASE_URL, cleanDatabase, memoryStorage, realFetch, signIn, type App } from '../test/helpers';
import { svgBytes, tinyPng } from '../test/images';
import { getPrisma } from './db';
import { createApp } from './index';
import { ApiError } from './errors';
import { resetEnvForTest } from './env';
import {
  acquireSlot,
  checkStepLimit,
  checkStorageQuota,
  maybeSendQuotaAlert,
  releaseSlot,
  resetQuotaStateForTests,
  startOfUtcDay,
} from './quota';

const prisma = getPrisma();

type Workspace = {
  organizationId: string;
  post: (init: { body?: BodyInit | null; headers?: Record<string, string> }) => Promise<Response>;
};

const setup = async (): Promise<Workspace> => {
  const app = createApp(async () => {}, memoryStorage());
  const cookie = await signIn(app);
  const organization = await prisma.organization.findFirstOrThrow();

  const post: Workspace['post'] = ({ body, headers }) =>
    app.handle(
      new Request(`${BASE_URL}/api/v1/assets`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'image/png', ...headers },
        body: body ?? null,
      }),
    );

  return { organizationId: organization.id, post };
};

/** A stream whose `pull` fires only once the consumer has actually started reading. */
const heldStream = () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let notifyStarted = () => {};
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  // highWaterMark 0 means `pull` fires only once the consumer calls reader.read(),
  // so `started` resolves exactly when readBody() begins reading, not on construction.
  const stream = new ReadableStream<Uint8Array>(
    {
      start(c) {
        controller = c;
      },
      pull() {
        notifyStarted();
      },
    },
    { highWaterMark: 0 },
  );
  return {
    stream,
    started,
    finish: (bytes: Uint8Array) => {
      controller.enqueue(bytes);
      controller.close();
    },
  };
};

const neverRead = () =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error('body must never be read'));
    },
  });

beforeEach(async () => {
  await cleanDatabase();
  resetQuotaStateForTests();
});

const ENV_KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'STORAGE_QUOTA_BYTES', 'MAX_STEPS_PER_RUN'] as const;
const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]));

const withEnv = (overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>) => {
  for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
  resetEnvForTest();
};

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvForTest();
});

afterAll(async () => {
  await cleanDatabase();
});

test('rejects a 5th concurrent upload with 429', async () => {
  const { post } = await setup();

  const held = [0, 1, 2, 3].map(() => heldStream());
  const pending = held.map((h) => post({ body: h.stream, headers: { 'x-opendocs-kind': 'step' } }));

  await Promise.all(held.map((h) => h.started));

  const fifth = await post({ body: neverRead(), headers: { 'x-opendocs-kind': 'step' } });
  expect(fifth.status).toBe(429);
  const body = (await fifth.json()) as { error: { code: string } };
  expect(body.error.code).toBe('quota_exceeded');

  const bytes = tinyPng();
  for (const h of held) h.finish(bytes);

  const responses = await Promise.all(pending);
  for (const response of responses) expect(response.status).toBe(201);
});

test('day boundary uses UTC', () => {
  const beforeMidnightUtc = new Date('2026-01-15T23:59:59.999Z');
  const afterMidnightUtc = new Date('2026-01-16T00:00:00.000Z');

  expect(startOfUtcDay(beforeMidnightUtc).toISOString()).toBe('2026-01-15T00:00:00.000Z');
  expect(startOfUtcDay(afterMidnightUtc).toISOString()).toBe('2026-01-16T00:00:00.000Z');

  // A moment that is late evening in UTC must not roll to the next day.
  const lateInDay = new Date(Date.UTC(2026, 0, 15, 22, 30));
  expect(startOfUtcDay(lateInDay).getUTCDate()).toBe(15);
  expect(startOfUtcDay(lateInDay).getUTCHours()).toBe(0);
});

test('decrements the concurrency counter on success and failure', async () => {
  const { post } = await setup();

  // 4 failures in a row: if the slot leaked on failure, the counter would sit at 4
  // and this 5th (valid) request would be rejected with 429 instead of succeeding.
  for (let index = 0; index < 4; index += 1) {
    const response = await post({
      body: svgBytes(),
      headers: { 'x-opendocs-kind': 'step', 'content-type': 'image/svg+xml' },
    });
    expect(response.status).toBe(415);
  }
  const afterFailures = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'step' } });
  expect(afterFailures.status).toBe(201);

  // 4 successes in a row: if the slot leaked on success, the counter would sit at 4
  // and this 5th request would be rejected with 429 instead of the header failure.
  for (let index = 0; index < 4; index += 1) {
    const response = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'step' } });
    expect(response.status).toBe(201);
  }
  const afterSuccesses = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'step' } });
  expect(afterSuccesses.status).toBe(201);
});

test('unaffected concurrency slots are unique per workspace', () => {
  const orgA = 'quota-unit-org-a';
  const orgB = 'quota-unit-org-b';

  acquireSlot(orgA);
  acquireSlot(orgA);
  acquireSlot(orgA);
  acquireSlot(orgA);
  expect(() => acquireSlot(orgA)).toThrow();

  // A different workspace has its own budget.
  expect(() => acquireSlot(orgB)).not.toThrow();

  releaseSlot(orgA);
  expect(() => acquireSlot(orgA)).not.toThrow();

  releaseSlot(orgA);
  releaseSlot(orgA);
  releaseSlot(orgA);
  releaseSlot(orgA);
  releaseSlot(orgB);
});

const seedStepAsset = async (organizationId: string, bytes: number) =>
  prisma.asset.create({
    data: {
      publicId: crypto.randomUUID().slice(0, 16),
      organizationId,
      kind: 'step',
      providerFileId: crypto.randomUUID(),
      mime: 'image/png',
      bytes,
      width: 1,
      height: 1,
      sha256: 'a'.repeat(64),
    },
  });

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof ApiError ? { status: error.statusCode, code: error.errorCode } : error;
  }
  return null;
};

test('checkStepLimit refuses once the run holds the configured number of steps', () => {
  withEnv({ MAX_STEPS_PER_RUN: '3' });

  expect(codeOf(() => checkStepLimit(2))).toBeNull();
  expect(codeOf(() => checkStepLimit(3))).toEqual({ status: 422, code: 'step_limit' });
});

test('checkStepLimit defaults to 15 steps', () => {
  expect(codeOf(() => checkStepLimit(14))).toBeNull();
  expect(codeOf(() => checkStepLimit(15))).toEqual({ status: 422, code: 'step_limit' });
});

test('checkStorageQuota is a no-op when STORAGE_QUOTA_BYTES is 0', async () => {
  const { organizationId } = await setup();
  await seedStepAsset(organizationId, 1_000_000);

  await checkStorageQuota({ organizationId, incomingBytes: 1_000_000_000, now: new Date() });
});

test('checkStorageQuota counts live step bytes only and allows exactly the cap', async () => {
  withEnv({ STORAGE_QUOTA_BYTES: '1000' });
  const { organizationId } = await setup();
  await seedStepAsset(organizationId, 600);
  // Expired and deleted step assets, and non-step kinds, do not count.
  const expired = await seedStepAsset(organizationId, 5000);
  await prisma.asset.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const deleted = await seedStepAsset(organizationId, 5000);
  await prisma.asset.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
  const snap = await seedStepAsset(organizationId, 5000);
  await prisma.asset.update({ where: { id: snap.id }, data: { kind: 'snap' } });

  await checkStorageQuota({ organizationId, incomingBytes: 400, now: new Date() });
  await expect(checkStorageQuota({ organizationId, incomingBytes: 401, now: new Date() })).rejects.toMatchObject({
    statusCode: 403,
    errorCode: 'storage_quota_exceeded',
  });
});

test('a step upload over the cap is refused with 403 and sends exactly one Telegram alert per day', async () => {
  withEnv({ STORAGE_QUOTA_BYTES: '10', TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: 'test-chat' });
  const { post, organizationId } = await setup();
  await seedStepAsset(organizationId, 10);

  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://api.telegram.org/')) {
      calls.push(url);
      return new Response('ok');
    }
    return realFetch(input);
  }) as typeof fetch;

  for (let index = 0; index < 2; index += 1) {
    const response = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'step' } });
    expect(response.status).toBe(403);
  }
  await Bun.sleep(20);

  expect(calls).toHaveLength(1);
});

test('maybeSendQuotaAlert sends once per UTC day and is silent without Telegram env', () => {
  const now = new Date('2026-02-10T12:00:00.000Z');
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('ok');
  }) as unknown as typeof fetch;

  // No Telegram configured: nothing is sent and the day is not consumed.
  maybeSendQuotaAlert({ now, fetchImpl });
  expect(calls).toBe(0);

  withEnv({ TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: 'test-chat' });
  maybeSendQuotaAlert({ now, fetchImpl });
  maybeSendQuotaAlert({ now, fetchImpl });
  expect(calls).toBe(1);

  // The next UTC day alerts again.
  maybeSendQuotaAlert({ now: new Date('2026-02-11T00:00:00.000Z'), fetchImpl });
  expect(calls).toBe(2);
});

test('maybeSendQuotaAlert never throws or leaks the token when fetch fails', async () => {
  withEnv({ TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: 'test-chat' });
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    const fetchImpl = (() => {
      throw new Error('boom test-token');
    }) as unknown as typeof fetch;
    expect(() => maybeSendQuotaAlert({ now: new Date('2026-03-01T00:00:00Z'), fetchImpl })).not.toThrow();
  } finally {
    console.error = original;
  }
  expect(JSON.stringify(logged)).not.toContain('test-token');
});

test('upload still succeeds when the Telegram call would throw', async () => {
  withEnv({ TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: 'test-chat' });
  const { post } = await setup();
  globalThis.fetch = (() => {
    throw new Error('network down');
  }) as unknown as typeof fetch;

  const response = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'step' } });

  expect(response.status).toBe(201);
});
