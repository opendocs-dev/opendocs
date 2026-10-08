import {
  DAILY_QUOTAS,
  GLOBAL_BREAKER_ALERT_BYTES,
  GLOBAL_BREAKER_BYTES,
} from '@opendocs/core';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { BASE_URL, cleanDatabase, realFetch, signIn, type App } from '../test/helpers';
import { svgBytes, tinyPng } from '../test/images';
import { getPrisma } from './db';
import { createApp } from './index';
import {
  acquireSlot,
  checkQuota,
  maybeSendBreakerAlert,
  releaseSlot,
  resetQuotaStateForTests,
  startOfUtcDay,
} from './quota';
import { LocalDiskProvider } from './storage/local';

const prisma = getPrisma();

type Workspace = {
  organizationId: string;
  post: (init: { body?: BodyInit | null; headers?: Record<string, string> }) => Promise<Response>;
};

const setup = async (): Promise<Workspace> => {
  const root = await mkdtemp(join(tmpdir(), 'od-quota-'));
  const app = createApp(async () => {}, { provider: new LocalDiskProvider(root), accounts: ['local'] });
  const cookie = await signIn(app);

  const session = await prisma.session.findFirstOrThrow({
    where: { activeOrganizationId: { not: null } },
    orderBy: { createdAt: 'desc' },
  });

  const post: Workspace['post'] = ({ body, headers }) =>
    app.handle(
      new Request(`${BASE_URL}/api/v1/assets`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'image/png', ...headers },
        body: body ?? null,
      }),
    );

  return { organizationId: session.activeOrganizationId!, post };
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

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
});

afterAll(async () => {
  await cleanDatabase();
});

test('rejects the 201st file for a Free workspace today', async () => {
  const { organizationId, post } = await setup();
  const day = startOfUtcDay(new Date());

  await prisma.usageDaily.create({
    data: { organizationId, day, files: DAILY_QUOTAS.free.files, bytes: 1000n },
  });

  const response = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'step' } });

  expect(response.status).toBe(429);
  const body = (await response.json()) as { error: { code: string; message: string } };
  expect(body.error.code).toBe('quota_exceeded');
  expect(body.error.message).toBe('daily file quota reached');
  expect(await prisma.asset.count()).toBe(0);
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

test('returns 429 breaker_open at 50GB global bytes today', async () => {
  const { post, organizationId } = await setup();
  const day = startOfUtcDay(new Date());

  await prisma.usageDaily.create({
    data: {
      organizationId: 'other-workspace-breaker',
      day,
      files: 1,
      bytes: BigInt(GLOBAL_BREAKER_BYTES),
    },
  });

  const response = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'step' } });

  expect(response.status).toBe(429);
  const body = (await response.json()) as { error: { code: string } };
  expect(body.error.code).toBe('breaker_open');
  expect(await prisma.asset.count()).toBe(0);

  // The breaker trips before the workspace's own quota is even inspected.
  await checkQuota({ organizationId, contentLengthHeader: null, now: new Date() }).catch((error) => {
    expect((error as { errorCode?: string }).errorCode).toBe('breaker_open');
  });
});

test('sends exactly one Telegram alert crossing 80%, no resend same day', async () => {
  const now = new Date('2026-02-10T12:00:00.000Z');

  await prisma.usageDaily.create({
    data: {
      organizationId: 'alert-test-org',
      day: startOfUtcDay(now),
      files: 1,
      bytes: BigInt(GLOBAL_BREAKER_ALERT_BYTES),
    },
  });

  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.TELEGRAM_CHAT_ID = 'test-chat';

  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('ok');
  }) as unknown as typeof fetch;

  await maybeSendBreakerAlert({ now, fetchImpl });
  await maybeSendBreakerAlert({ now, fetchImpl });

  expect(calls).toBe(1);
});

test('upload still succeeds when the Telegram call throws', async () => {
  const { post } = await setup();
  const day = startOfUtcDay(new Date());

  await prisma.usageDaily.create({
    data: {
      organizationId: 'alert-throws-org',
      day,
      files: 1,
      bytes: BigInt(GLOBAL_BREAKER_ALERT_BYTES),
    },
  });

  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.TELEGRAM_CHAT_ID = 'test-chat';
  globalThis.fetch = (() => {
    throw new Error('network down');
  }) as unknown as typeof fetch;

  const response = await post({ body: tinyPng(), headers: { 'x-opendocs-kind': 'step' } });

  expect(response.status).toBe(201);
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
