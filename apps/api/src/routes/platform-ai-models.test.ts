import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { BASE_URL, cleanDatabase, GITHUB_ACCOUNT, OTHER_GITHUB_ACCOUNT, realFetch, signIn, type App } from '../../test/helpers';
import { getPrisma } from '../db';
import { createApp } from '../index';
import { decryptAiSecret } from '../platform/ai-secret';

const prisma = getPrisma();

const newApp = (): App => createApp(async () => {});

const withAdminEnv = async (fn: () => Promise<void>) => {
  const previous = process.env.PLATFORM_ADMIN_EMAILS;
  process.env.PLATFORM_ADMIN_EMAILS = GITHUB_ACCOUNT.email ?? '';
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
    else process.env.PLATFORM_ADMIN_EMAILS = previous;
  }
};

beforeEach(async () => {
  await cleanDatabase();
  await prisma.aiModel.deleteMany();
  await prisma.aiProvider.deleteMany();
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete process.env.PLATFORM_ADMIN_EMAILS;
});

afterAll(async () => {
  await cleanDatabase();
  await prisma.aiModel.deleteMany();
  await prisma.aiProvider.deleteMany();
});

test('non-staff users receive 403 when accessing platform AI routes', async () => {
  const app = newApp();
  process.env.PLATFORM_ADMIN_EMAILS = GITHUB_ACCOUNT.email ?? '';
  const cookie = await signIn(app, OTHER_GITHUB_ACCOUNT);

  // GET models
  const resGet = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/ai/models`, { headers: { cookie } }),
  );
  expect(resGet.status).toBe(403);

  // POST model
  const resPost = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/ai/models`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        modelId: 'test-model',
        name: 'Test Model',
      }),
    }),
  );
  expect(resPost.status).toBe(403);

  // Providers
  const resProviders = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/ai/providers`, { headers: { cookie } }),
  );
  expect(resProviders.status).toBe(403);

  // Anonymous user receives 401
  const resAnon = await app.handle(new Request(`${BASE_URL}/api/v1/platform/ai/models`));
  expect(resAnon.status).toBe(401);
});

test('staff can create model, update creditsPerReply, and default model remains unique', () =>
  withAdminEnv(async () => {
    const app = newApp();
    const cookie = await signIn(app, GITHUB_ACCOUNT);

    // List seeded models
    const listRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/ai/models`, { headers: { cookie } }),
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { models: Array<{ name: string; isDefault: boolean }> };
    expect(listBody.models.length).toBeGreaterThanOrEqual(1);

    // Initial default model
    const initialDefault = listBody.models.find((m) => m.isDefault);
    expect(initialDefault).toBeDefined();

    // Create a new model and set it as default
    const createRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/ai/models`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'anthropic',
          modelId: 'claude-opus-4-5',
          name: 'Claude Opus 4.5',
          label: 'Advanced',
          creditsPerReply: 10,
          plans: ['enterprise'],
          status: 'active',
          isDefault: true,
        }),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; creditsPerReply: number; name: string; isDefault: boolean };
    expect(created.name).toBe('Claude Opus 4.5');
    expect(created.creditsPerReply).toBe(10);
    expect(created.isDefault).toBe(true);

    // Verify only 1 default model exists in database
    const defaultsCount = await prisma.aiModel.count({ where: { isDefault: true } });
    expect(defaultsCount).toBe(1);

    // Update creditsPerReply to 12
    const patchRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/ai/models/${created.id}`, {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          creditsPerReply: 12,
        }),
      }),
    );
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { creditsPerReply: number };
    expect(patched.creditsPerReply).toBe(12);

    // Verify in database
    const dbModel = await prisma.aiModel.findUnique({ where: { id: created.id } });
    expect(dbModel?.creditsPerReply).toBe(12);
  }));

test('price change on model does not alter past ledger rows', () =>
  withAdminEnv(async () => {
    const app = newApp();
    const cookie = await signIn(app, GITHUB_ACCOUNT);

    // Create org
    const org = await prisma.organization.create({
      data: { id: 'org-price-history', name: 'Price History Org', slug: 'price-history-org' },
    });

    // Create model with 5 credits
    const model = await prisma.aiModel.create({
      data: {
        provider: 'anthropic',
        modelId: 'claude-test-hist',
        name: 'Claude Test Hist',
        label: 'Advanced',
        creditsPerReply: 5,
        status: 'active',
      },
    });

    // Record past reply charge in ledger
    const pastLedger = await prisma.aiCreditLedger.create({
      data: {
        organizationId: org.id,
        delta: -5,
        reason: 'reply_charge',
        messageId: 'msg-past-reply-1',
        modelId: model.id,
        credits: 5,
        balanceAfter: 95,
      },
    });

    // Change model price to 8 credits
    const patchRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/ai/models/${model.id}`, {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ creditsPerReply: 8 }),
      }),
    );
    expect(patchRes.status).toBe(200);

    // Verify past ledger row remains untouched at 5 credits
    const readPastLedger = await prisma.aiCreditLedger.findUniqueOrThrow({
      where: { id: pastLedger.id },
    });
    expect(readPastLedger.credits).toBe(5);
    expect(readPastLedger.delta).toBe(-5);
  }));

test('retiring a model migrates tenants on it to the default model', () =>
  withAdminEnv(async () => {
    const app = newApp();
    const cookie = await signIn(app, GITHUB_ACCOUNT);

    // Ensure a default model exists
    const defaultModel = await prisma.aiModel.create({
      data: {
        provider: 'openai',
        modelId: 'gpt-luna-def',
        name: 'GPT Luna Def',
        label: 'Standard',
        creditsPerReply: 1,
        status: 'active',
        isDefault: true,
      },
    });

    // Create model to be retired
    const oldModel = await prisma.aiModel.create({
      data: {
        provider: 'anthropic',
        modelId: 'claude-old',
        name: 'Claude Old',
        label: 'Advanced',
        creditsPerReply: 5,
        status: 'active',
        isDefault: false,
      },
    });

    // Create tenant assistant pointing to oldModel
    const org = await prisma.organization.create({
      data: { id: 'org-retire-test', name: 'Retire Test', slug: 'retire-test' },
    });
    await prisma.aiAssistant.create({
      data: {
        organizationId: org.id,
        modelId: oldModel.id,
      },
    });

    // Retire oldModel
    const patchRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/ai/models/${oldModel.id}`, {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'retired' }),
      }),
    );
    expect(patchRes.status).toBe(200);

    // Verify tenant assistant was migrated to defaultModel
    const updatedAssistant = await prisma.aiAssistant.findUniqueOrThrow({
      where: { organizationId: org.id },
    });
    expect(updatedAssistant.modelId).toBe(defaultModel.id);
  }));

test('validates and encrypts provider secret key, never leaking raw secret', () =>
  withAdminEnv(async () => {
    const app = newApp();
    const cookie = await signIn(app, GITHUB_ACCOUNT);

    const rawSecret = ['sk', 'ant', 'api03', 'very-secret-test-key-12345'].join('-');

    // Save provider with secret
    const saveRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/ai/providers`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'anthropic',
          secret: rawSecret,
        }),
      }),
    );
    expect(saveRes.status).toBe(200);
    const saveBody = (await saveRes.json()) as {
      provider: string;
      hasSecret: boolean;
      maskedSecret: string;
    };

    // Secret must NOT be returned raw to the browser
    expect(saveBody.hasSecret).toBe(true);
    expect(saveBody.maskedSecret).not.toBe(rawSecret);
    expect(saveBody.maskedSecret).toContain('••••••••');
    expect(JSON.stringify(saveBody)).not.toContain(rawSecret);

    // Check database storage: secret must be encrypted (iv:ciphertext:tag)
    const stored = await prisma.aiProvider.findUniqueOrThrow({ where: { provider: 'anthropic' } });
    expect(stored.secret).not.toBe(rawSecret);
    expect(stored.secret.split(':').length).toBe(3);
    expect(decryptAiSecret(stored.secret)).toBe(rawSecret);

    // GET providers list: never exposes raw secret
    const getRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/ai/providers`, { headers: { cookie } }),
    );
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as { providers: Array<{ provider: string; maskedSecret: string }> };
    expect(getBody.providers.length).toBe(1);
    expect(getBody.providers[0]?.maskedSecret).not.toBe(rawSecret);
    expect(JSON.stringify(getBody)).not.toContain(rawSecret);

    // Test endpoint with configured key
    const testRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/ai/providers/test`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'anthropic',
        }),
      }),
    );
    expect(testRes.status).toBe(200);
    const testBody = (await testRes.json()) as { ok: boolean };
    expect(testBody.ok).toBe(true);

    // Test invalid key: rejection without leaking secret
    const testInvalidRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/ai/providers/test`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'anthropic',
          secret: 'invalid-key',
        }),
      }),
    );
    expect(testInvalidRes.status).toBe(200);
    const testInvalidBody = (await testInvalidRes.json()) as { ok: boolean; error: string };
    expect(testInvalidBody.ok).toBe(false);
    expect(testInvalidBody.error).toBeDefined();
    expect(JSON.stringify(testInvalidBody)).not.toContain(rawSecret);
  }));
