import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { BASE_URL, cleanDatabase, realFetch } from '../../test/helpers';
import { restoreEnv, setEnv } from '../../test/env';
import { getPrisma } from '../db';
import { createApp } from '../index';
import { getInstanceOrg } from '../instance-org';
import { newPublicId } from '../ids';
import { getPublicAssistantConfig, NO_MATCH_ANSWER, processChat } from './chat-service';
import { maskPii } from './pii';

const prisma = getPrisma();
const fakeKey = () => ['test', 'ai', 'key'].join('-');

beforeEach(async () => {
  await cleanDatabase();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  restoreEnv();
});

afterAll(async () => {
  await cleanDatabase();
});

const enableAi = (extra: Record<string, string> = {}) =>
  setEnv({ AI_API_KEY: fakeKey(), AI_MODEL: 'test-model', AI_BASE_URL: 'https://ai.example.com/v1', ...extra });

/** Seeds a published guide about resetting a password. */
const seedGuide = async () => {
  const org = await getInstanceOrg();
  const flow = await prisma.flow.create({
    data: { publicId: newPublicId(), organizationId: org.id, title: 'Reset your password', slug: 'reset-your-password', visibility: 'published' },
  });
  const run = await prisma.run.create({ data: { publicId: newPublicId(), flowId: flow.id, status: 'compiled' } });
  await prisma.flow.update({ where: { id: flow.id }, data: { latestRunId: run.id } });
  await prisma.step.createMany({
    data: [
      { runId: run.id, order: 1, action: 'click', instruction: 'Open the password settings page' },
      { runId: run.id, order: 2, action: 'click', instruction: 'Press the reset password button' },
    ],
  });
  return flow;
};

type Call = { url: string; init: RequestInit };
const fakeModel = (answer = 'Open settings and press reset.') => {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ choices: [{ message: { content: answer } }], usage: { total_tokens: 42 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { impl, calls };
};

describe('PII masking', () => {
  test('masks email, phone, card, ip, and secrets', () => {
    const secret = ['sk', 'ant', 'api03', 'abcdef1234567890'].join('-');
    const output = maskPii(`Contact user@example.com or call +1 555-123-4567. Card: 4111 2222 3333 4444. IP: 192.168.1.100. Secret: ${secret}`);
    expect(output).toContain('[EMAIL]');
    expect(output).toContain('[PHONE]');
    expect(output).toContain('[CARD]');
    expect(output).toContain('[IP]');
    expect(output).toContain('[SECRET]');
    expect(output).not.toContain(secret);
  });
});

describe('AI from env', () => {
  test('disabled when key empty', async () => {
    expect(getPublicAssistantConfig()).toEqual({ enabled: false });
    await expect(processChat('how do I reset my password', 'v1')).rejects.toMatchObject({ statusCode: 404 });
  });

  test('enabled config never contains the key', () => {
    enableAi();
    const config = getPublicAssistantConfig();
    expect(config.enabled).toBe(true);
    expect(JSON.stringify(config)).not.toContain(fakeKey());
  });

  test('uses AI_MODEL and base url, grounded on the guide', async () => {
    enableAi();
    await seedGuide();
    const model = fakeModel();

    const result = await processChat('how do I reset my password', 'v1', undefined, model.impl);

    expect(result.status).toBe('answered');
    expect(result.content).toBe('Open settings and press reset.');
    expect(result.sources.map((s) => s.slug)).toEqual(['reset-your-password']);
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]!.url).toBe('https://ai.example.com/v1/chat/completions');
    const body = JSON.parse(String(model.calls[0]!.init.body));
    expect(body.model).toBe('test-model');
    expect(JSON.stringify(body.messages)).toContain('Press the reset password button');
    expect((model.calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${fakeKey()}`);
  });

  test('no matching guide answers that the docs do not cover it, without calling the model', async () => {
    enableAi();
    await seedGuide();
    const model = fakeModel();

    const result = await processChat('quantum entanglement', 'v1', undefined, model.impl);

    expect(result.status).toBe('no_match');
    expect(result.content).toBe(NO_MATCH_ANSWER);
    expect(model.calls).toHaveLength(0);
  });

  test('draft guides are never used as sources', async () => {
    enableAi();
    const flow = await seedGuide();
    await prisma.flow.update({ where: { id: flow.id }, data: { visibility: 'draft' } });
    const model = fakeModel();

    const result = await processChat('reset password', 'v1', undefined, model.impl);

    expect(result.status).toBe('no_match');
  });

  test('the question is PII-masked before it reaches the model and the database', async () => {
    enableAi();
    await seedGuide();
    const model = fakeModel();

    await processChat('reset password for user@example.com', 'v1', undefined, model.impl);

    expect(String(model.calls[0]!.init.body)).not.toContain('user@example.com');
    const stored = await prisma.aiMessage.findFirstOrThrow({ where: { role: 'user' } });
    expect(stored.content).toContain('[EMAIL]');
  });

  test('a failing model returns 502 and does not burn a question', async () => {
    enableAi({ AI_DAILY_MESSAGE_LIMIT: '1' });
    await seedGuide();
    const failing = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;

    await expect(processChat('reset password', 'v1', undefined, failing)).rejects.toMatchObject({ statusCode: 502 });
    expect(await prisma.aiMessage.count()).toBe(0);
  });

  test('11th question in one session refused when limit is 10; a new session can ask again', async () => {
    enableAi({ AI_DAILY_MESSAGE_LIMIT: '10' });
    await seedGuide();
    const model = fakeModel();

    const first = await processChat('reset password', 'v1', undefined, model.impl);
    for (let i = 2; i <= 10; i++) {
      await processChat('reset password', 'v1', first.conversation_id, model.impl);
    }
    await expect(processChat('reset password', 'v1', first.conversation_id, model.impl)).rejects.toMatchObject({
      statusCode: 429,
      errorCode: 'quota_exceeded',
    });

    const fresh = await processChat('reset password', 'v1', undefined, model.impl);
    expect(fresh.conversation_id).not.toBe(first.conversation_id);
    expect(fresh.status).toBe('answered');
  });

  test('only questions asked today count, and 0 means unlimited', async () => {
    enableAi({ AI_DAILY_MESSAGE_LIMIT: '1' });
    await seedGuide();
    const model = fakeModel();
    const first = await processChat('reset password', 'v1', undefined, model.impl);
    await prisma.aiMessage.updateMany({ data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } });
    await expect(processChat('reset password', 'v1', first.conversation_id, model.impl)).resolves.toMatchObject({ status: 'answered' });

    setEnv({ AI_DAILY_MESSAGE_LIMIT: '0' });
    for (let i = 0; i < 3; i++) await processChat('reset password', 'v1', first.conversation_id, model.impl);
  });
});

describe('public routes', () => {
  test('/site/assistant reflects the env and the key never appears', async () => {
    const app = createApp(async () => {});
    const off = await app.handle(new Request(`${BASE_URL}/api/v1/site/assistant`));
    expect(await off.json()).toEqual({ enabled: false });

    enableAi();
    const on = await app.handle(new Request(`${BASE_URL}/api/v1/site/assistant`));
    const text = await on.text();
    expect(JSON.parse(text).enabled).toBe(true);
    expect(text).not.toContain(fakeKey());
  });

  test('POST /site/chat is 404 when AI is off', async () => {
    const app = createApp(async () => {});
    const response = await app.handle(
      new Request(`${BASE_URL}/api/v1/site/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'hi' }),
      }),
    );
    expect(response.status).toBe(404);
  });
});
