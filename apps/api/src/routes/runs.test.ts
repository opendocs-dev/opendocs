import { DEFAULT_MAX_STEPS_PER_RUN } from '@opendocs/core';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import {
  BASE_URL,
  cleanDatabase,
  OTHER_GITHUB_ACCOUNT,
  realFetch,
  signIn,
  type App,
} from '../../test/helpers';
import { tinyPng } from '../../test/images';
import { getPrisma } from '../db';
import { createApp } from '../index';
import { LocalDiskProvider } from '../storage/local';

const prisma = getPrisma();

type Workspace = {
  app: App;
  cookie: string;
  organizationId: string;
  /** Uploads one image and returns its public asset id. */
  upload: () => Promise<string>;
  createRun: (body?: unknown) => Promise<Response>;
  addStep: (sessionId: string, body: unknown) => Promise<Response>;
  compile: (sessionId: string, body?: unknown) => Promise<Response>;
};

const newApp = async (): Promise<App> => {
  const root = await mkdtemp(join(tmpdir(), 'od-runs-'));
  return createApp(async () => {}, {
    provider: new LocalDiskProvider(root),
    accounts: ['local'],
  });
};

const workspace = async (app: App, account: Parameters<typeof signIn>[1] = {}): Promise<Workspace> => {
  const cookie = await signIn(app, account);
  const post = (path: string, body: unknown) =>
    app.handle(
      new Request(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      }),
    );

  const session = await prisma.session.findFirstOrThrow({
    where: { activeOrganizationId: { not: null } },
    orderBy: { createdAt: 'desc' },
  });

  return {
    app,
    cookie,
    organizationId: session.activeOrganizationId!,
    upload: async () => {
      const response = await app.handle(
        new Request(`${BASE_URL}/api/v1/assets`, {
          method: 'POST',
          headers: { cookie, 'content-type': 'image/png', 'x-opendocs-kind': 'step' },
          body: tinyPng(),
        }),
      );
      expect(response.status).toBe(201);
      return ((await response.json()) as { id: string }).id;
    },
    createRun: (body) => post('/api/v1/runs', body),
    addStep: (sessionId, body) => post(`/api/v1/runs/${sessionId}/steps`, body),
    compile: (sessionId, body) => post(`/api/v1/runs/${sessionId}/compile`, body),
  };
};

const stepBody = (assetId: string, overrides: Record<string, unknown> = {}) => ({
  asset_id: assetId,
  action: 'click',
  selector: '#save',
  instruction: 'Click Save',
  ...overrides,
});

const errorCode = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

/** Fills a run up to `total` steps directly, so limit cases do not need N requests. */
const seedSteps = async (runId: string, assetId: string, total: number) => {
  for (let order = 1; order <= total; order += 1) {
    await prisma.step.create({
      data: { runId, order, action: 'click', instruction: `Step ${order}`, assetId },
    });
  }
};

beforeEach(async () => {
  await cleanDatabase();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  await cleanDatabase();
});

test('creates flow and run without flow_id', async () => {
  const ws = await workspace(await newApp());

  const response = await ws.createRun({ title: 'Reset a password' });

  expect(response.status).toBe(201);
  const body = (await response.json()) as { session_id: string };
  expect(body.session_id).toMatch(/^[0-9A-Za-z]{16}$/);

  const run = await prisma.run.findUniqueOrThrow({
    where: { publicId: body.session_id },
    include: { flow: true },
  });
  expect(run.status).toBe('recording');
  expect(run.compiledAt).toBeNull();
  expect(run.flow.title).toBe('Reset a password');
  expect(run.flow.organizationId).toBe(ws.organizationId);
  expect(run.flow.locale).toBe('en');
  expect(run.flow.latestRunId).toBeNull();
});

test('creates a new run for an existing same-workspace flow', async () => {
  const ws = await workspace(await newApp());

  const first = await ws.createRun({});
  expect(first.status).toBe(201);
  const flow = await prisma.flow.findFirstOrThrow();
  expect(flow.title).toBe('Untitled flow');

  const second = await ws.createRun({ flow_id: flow.publicId });

  expect(second.status).toBe(201);
  const sessionId = ((await second.json()) as { session_id: string }).session_id;

  expect(await prisma.flow.count()).toBe(1);
  expect(await prisma.run.count()).toBe(2);
  const run = await prisma.run.findUniqueOrThrow({ where: { publicId: sessionId } });
  expect(run.flowId).toBe(flow.id);

  const unchanged = await prisma.flow.findUniqueOrThrow({ where: { id: flow.id } });
  expect(unchanged.latestRunId).toBeNull();
});

test('rejects flow_id from another workspace with 404', async () => {
  const app = await newApp();
  const owner = await workspace(app);
  expect((await owner.createRun({})).status).toBe(201);
  const flow = await prisma.flow.findFirstOrThrow();

  const other = await workspace(app, OTHER_GITHUB_ACCOUNT);
  expect(other.organizationId).not.toBe(owner.organizationId);

  const response = await other.createRun({ flow_id: flow.publicId });

  expect(response.status).toBe(404);
  expect(await errorCode(response)).toBe('not_found');
  expect(await prisma.run.count()).toBe(1);
});

test('adds a step referencing an own-workspace asset', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();

  const response = await ws.addStep(
    sessionId,
    stepBody(assetId, {
      action: 'type',
      page_url: 'https://app.example/settings',
      redaction: { mode: 'strict', report: { count: 2, script_version: '1.0.0' } },
    }),
  );

  expect(response.status).toBe(201);
  expect((await response.json()) as { order: number }).toEqual({ order: 1 });

  const step = await prisma.step.findFirstOrThrow();
  const asset = await prisma.asset.findUniqueOrThrow({ where: { publicId: assetId } });
  expect(step.assetId).toBe(asset.id);
  expect(step.action).toBe('type');
  expect(step.selector).toBe('#save');
  expect(step.instruction).toBe('Click Save');
  expect(step.pageUrl).toBe('https://app.example/settings');
  expect(step.redactionMode).toBe('strict');
  expect(step.redactionReport).toEqual({ count: 2, script_version: '1.0.0' });
  expect(step.box).toBeNull();
});

test('stores strict mode with its report', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();

  const response = await ws.addStep(
    sessionId,
    stepBody(assetId, {
      redaction: { mode: 'strict', report: { count: 3, script_version: '1.0.0' } },
    }),
  );

  expect(response.status).toBe(201);
  const step = await prisma.step.findFirstOrThrow();
  expect(step.redactionMode).toBe('strict');
  expect(step.redactionReport).toEqual({ count: 3, script_version: '1.0.0' });

  const run = await prisma.run.findUniqueOrThrow({ where: { publicId: sessionId } });
  expect(run.hasUnredactedStep).toBe(false);
});

test('rejects basic mode without a report as redaction_report_missing', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();

  const response = await ws.addStep(
    sessionId,
    stepBody(assetId, { redaction: { mode: 'basic' } }),
  );

  expect(response.status).toBe(422);
  expect(await errorCode(response)).toBe('redaction_report_missing');
  expect(await prisma.step.count()).toBe(0);
});

test('off mode sets the not-redacted flag', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();

  const response = await ws.addStep(sessionId, stepBody(assetId, { redaction: { mode: 'off' } }));

  expect(response.status).toBe(201);
  const step = await prisma.step.findFirstOrThrow();
  expect(step.redactionMode).toBe('off');

  const run = await prisma.run.findUniqueOrThrow({ where: { publicId: sessionId } });
  expect(run.hasUnredactedStep).toBe(true);
});

test('a step without redaction is stored as off', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();

  const response = await ws.addStep(sessionId, stepBody(assetId));

  expect(response.status).toBe(201);
  const step = await prisma.step.findFirstOrThrow();
  expect(step.redactionMode).toBe('off');

  const run = await prisma.run.findUniqueOrThrow({ where: { publicId: sessionId } });
  expect(run.hasUnredactedStep).toBe(true);
});

test('rejects an asset from another workspace with 404', async () => {
  const app = await newApp();
  const owner = await workspace(app);
  const assetId = await owner.upload();

  const other = await workspace(app, OTHER_GITHUB_ACCOUNT);
  const sessionId = ((await (await other.createRun({})).json()) as { session_id: string })
    .session_id;

  const response = await other.addStep(sessionId, stepBody(assetId));

  expect(response.status).toBe(404);
  expect(await errorCode(response)).toBe('not_found');
  expect(await prisma.step.count()).toBe(0);
});

test('stores title and alt', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();

  const response = await ws.addStep(
    sessionId,
    stepBody(assetId, { title: 'Save the form', alt: 'Screenshot of the save button' }),
  );

  expect(response.status).toBe(201);
  const step = await prisma.step.findFirstOrThrow();
  expect(step.title).toBe('Save the form');
  expect(step.alt).toBe('Screenshot of the save button');
});

test('accepts a report with viewport and iframes', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();

  const response = await ws.addStep(
    sessionId,
    stepBody(assetId, {
      redaction: {
        mode: 'strict',
        report: { count: 1, script_version: '1.0.0', viewport: { w: 1280, h: 800, dpr: 2 }, iframes: 1 },
      },
    }),
  );

  expect(response.status).toBe(201);
  const step = await prisma.step.findFirstOrThrow();
  expect(step.redactionReport).toEqual({
    count: 1,
    script_version: '1.0.0',
    viewport: { w: 1280, h: 800, dpr: 2 },
    iframes: 1,
  });
});

test('rejects a non-number iframes', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();

  const response = await ws.addStep(
    sessionId,
    stepBody(assetId, {
      redaction: { mode: 'strict', report: { count: 1, script_version: '1.0.0', iframes: 'two' } },
    }),
  );

  expect(response.status).toBe(422);
  expect(await errorCode(response)).toBe('validation_failed');
  expect(await prisma.step.count()).toBe(0);
});

test('accepts a box without a selector', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();

  const response = await ws.addStep(
    sessionId,
    stepBody(assetId, { selector: undefined, box: { x: 4, y: 8, w: 120, h: 32 } }),
  );

  expect(response.status).toBe(201);
  const step = await prisma.step.findFirstOrThrow();
  expect(step.selector).toBeNull();
  expect(step.box).toEqual({ x: 4, y: 8, w: 120, h: 32 });
});

test('accepts the 15th step on Free', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  const run = await prisma.run.findUniqueOrThrow({ where: { publicId: sessionId } });
  const asset = await prisma.asset.findUniqueOrThrow({ where: { publicId: assetId } });

  await seedSteps(run.id, asset.id, DEFAULT_MAX_STEPS_PER_RUN - 1);

  const response = await ws.addStep(sessionId, stepBody(assetId));

  expect(response.status).toBe(201);
  expect((await response.json()) as { order: number }).toEqual({ order: DEFAULT_MAX_STEPS_PER_RUN });
  expect(await prisma.step.count()).toBe(DEFAULT_MAX_STEPS_PER_RUN);
});

test('rejects the 16th step on Free with 422 step_limit', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  const run = await prisma.run.findUniqueOrThrow({ where: { publicId: sessionId } });
  const asset = await prisma.asset.findUniqueOrThrow({ where: { publicId: assetId } });

  await seedSteps(run.id, asset.id, DEFAULT_MAX_STEPS_PER_RUN);

  const response = await ws.addStep(sessionId, stepBody(assetId));

  expect(response.status).toBe(422);
  expect(await errorCode(response)).toBe('step_limit');
  expect(await prisma.step.count()).toBe(DEFAULT_MAX_STEPS_PER_RUN);
});

test('a Pro run accepts a 16th step', async () => {
  const ws = await workspace(await newApp());
  await prisma.workspaceBilling.create({
    data: { organizationId: ws.organizationId, plan: 'pro' },
  });

  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  const run = await prisma.run.findUniqueOrThrow({ where: { publicId: sessionId } });
  const asset = await prisma.asset.findUniqueOrThrow({ where: { publicId: assetId } });

  await seedSteps(run.id, asset.id, DEFAULT_MAX_STEPS_PER_RUN);

  const response = await ws.addStep(sessionId, stepBody(assetId));

  expect(response.status).toBe(201);
  expect((await response.json()) as { order: number }).toEqual({ order: DEFAULT_MAX_STEPS_PER_RUN + 1 });
  expect(await prisma.step.count()).toBe(DEFAULT_MAX_STEPS_PER_RUN + 1);
});

test('adding a step to a compiled run returns 409', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await prisma.run.update({
    where: { publicId: sessionId },
    data: { status: 'compiled', compiledAt: new Date() },
  });

  const response = await ws.addStep(sessionId, stepBody(assetId));

  expect(response.status).toBe(409);
  expect(await errorCode(response)).toBe('run_compiled');
  expect(await prisma.step.count()).toBe(0);
});

test('compiles a run and sets flow.latestRunId', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId));

  const response = await ws.compile(sessionId, { title: 'Reset a password' });

  expect(response.status).toBe(200);
  const body = (await response.json()) as { url: string };
  expect(body.url).toBe(`${process.env.BETTER_AUTH_URL}/d/${(await prisma.flow.findFirstOrThrow()).publicId}`);

  const run = await prisma.run.findUniqueOrThrow({ where: { publicId: sessionId } });
  expect(run.status).toBe('compiled');
  expect(run.compiledAt).not.toBeNull();

  const flow = await prisma.flow.findFirstOrThrow();
  expect(flow.latestRunId).toBe(run.id);
  expect(flow.title).toBe('Reset a password');
});

test('a second compile call is idempotent', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId));

  const first = await ws.compile(sessionId);
  expect(first.status).toBe(200);
  const firstBody = (await first.json()) as { url: string };

  const runAfterFirst = await prisma.run.findUniqueOrThrow({ where: { publicId: sessionId } });

  const second = await ws.compile(sessionId, { title: 'Should not change anything' });
  expect(second.status).toBe(200);
  const secondBody = (await second.json()) as { url: string };
  expect(secondBody.url).toBe(firstBody.url);

  const runAfterSecond = await prisma.run.findUniqueOrThrow({ where: { publicId: sessionId } });
  expect(runAfterSecond.compiledAt).toEqual(runAfterFirst.compiledAt);

  const flow = await prisma.flow.findFirstOrThrow();
  expect(flow.title).not.toBe('Should not change anything');
});

test('rejects steps on a compiled run with 409', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId));
  await ws.compile(sessionId);

  const response = await ws.addStep(sessionId, stepBody(assetId));

  expect(response.status).toBe(409);
  expect(await errorCode(response)).toBe('run_compiled');
  expect(await prisma.step.count()).toBe(1);
});

test('rejects compiling zero steps', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;

  const response = await ws.compile(sessionId);

  expect(response.status).toBe(422);
  expect(await errorCode(response)).toBe('validation_failed');

  const run = await prisma.run.findUniqueOrThrow({ where: { publicId: sessionId } });
  expect(run.status).toBe('recording');
});

test('requires an API key or session', async () => {
  const app = await newApp();

  const response = await app.handle(
    new Request(`${BASE_URL}/api/v1/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }),
  );

  expect(response.status).toBe(401);
  expect(await errorCode(response)).toBe('unauthorized');
  expect(await prisma.run.count()).toBe(0);
});

test('rejects a malformed body and a short flow_id with 422', async () => {
  const ws = await workspace(await newApp());

  const badBody = await ws.createRun({ title: 42 });
  expect(badBody.status).toBe(422);
  expect(await errorCode(badBody)).toBe('validation_failed');

  const shortId = await ws.createRun({ flow_id: 'abc' });
  expect(shortId.status).toBe(422);
  expect(await errorCode(shortId)).toBe('validation_failed');

  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const badStep = await ws.addStep(sessionId, { asset_id: 'x', action: 'jump' });
  expect(badStep.status).toBe(422);
  expect(await errorCode(badStep)).toBe('validation_failed');
  expect(await prisma.step.count()).toBe(0);
});

test('an unknown run id is 404', async () => {
  const ws = await workspace(await newApp());
  const assetId = await ws.upload();

  const response = await ws.addStep('0123456789ABCDEF', stepBody(assetId));

  expect(response.status).toBe(404);
  expect(await errorCode(response)).toBe('not_found');
});

test("a deleted flow's run rejects new steps with 404", async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await prisma.flow.updateMany({ data: { deletedAt: new Date() } });

  const response = await ws.addStep(sessionId, stepBody(assetId));

  expect(response.status).toBe(404);
  expect(await prisma.step.count()).toBe(0);
});

test('deleting a workspace removes its flows, runs, steps and assets', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  expect((await ws.addStep(sessionId, stepBody(assetId))).status).toBe(201);

  await prisma.organization.delete({ where: { id: ws.organizationId } });

  expect(await prisma.step.count()).toBe(0);
  expect(await prisma.run.count()).toBe(0);
  expect(await prisma.flow.count()).toBe(0);
  expect(await prisma.asset.count()).toBe(0);
});

test("compile makes the run's images permanent", async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId));

  const response = await ws.compile(sessionId);
  expect(response.status).toBe(200);

  const asset = await prisma.asset.findUniqueOrThrow({ where: { publicId: assetId } });
  expect(asset.expiresAt).toBeNull();
});

test("compiling a new run gives the previous run's images a 7 day grace", async () => {
  const ws = await workspace(await newApp());
  const firstSessionId = ((await (await ws.createRun({})).json()) as { session_id: string })
    .session_id;
  const firstAssetId = await ws.upload();
  await ws.addStep(firstSessionId, stepBody(firstAssetId));
  await ws.compile(firstSessionId);

  const firstAsset = await prisma.asset.findUniqueOrThrow({ where: { publicId: firstAssetId } });
  expect(firstAsset.expiresAt).toBeNull();

  const flow = await prisma.flow.findFirstOrThrow();
  const secondSessionId = ((await (await ws.createRun({ flow_id: flow.publicId })).json()) as {
    session_id: string;
  }).session_id;
  const secondAssetId = await ws.upload();
  await ws.addStep(secondSessionId, stepBody(secondAssetId));

  const before = Date.now();
  const response = await ws.compile(secondSessionId);
  expect(response.status).toBe(200);

  const firstAssetAfter = await prisma.asset.findUniqueOrThrow({ where: { publicId: firstAssetId } });
  expect(firstAssetAfter.expiresAt).not.toBeNull();
  const graceMs = firstAssetAfter.expiresAt!.getTime() - before;
  expect(graceMs).toBeGreaterThan(6 * 86_400_000);
  expect(graceMs).toBeLessThan(8 * 86_400_000);

  const secondAssetAfter = await prisma.asset.findUniqueOrThrow({ where: { publicId: secondAssetId } });
  expect(secondAssetAfter.expiresAt).toBeNull();
});

test('second compile changes nothing', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId));
  await ws.compile(sessionId);

  const afterFirst = await prisma.asset.findUniqueOrThrow({ where: { publicId: assetId } });
  expect(afterFirst.expiresAt).toBeNull();

  const response = await ws.compile(sessionId);
  expect(response.status).toBe(200);

  const afterSecond = await prisma.asset.findUniqueOrThrow({ where: { publicId: assetId } });
  expect(afterSecond.expiresAt).toBeNull();
});

test('expired draft stays expired after compile', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId));

  const expiredAt = new Date(Date.now() - 1000);
  await prisma.asset.update({ where: { publicId: assetId }, data: { expiresAt: expiredAt } });

  const response = await ws.compile(sessionId);
  expect(response.status).toBe(200);

  const asset = await prisma.asset.findUniqueOrThrow({ where: { publicId: assetId } });
  expect(asset.expiresAt).toEqual(expiredAt);
});

test('compile sets the flow slug from the title', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({ title: 'Create a WhatsApp template!' })).json()) as {
    session_id: string;
  }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId));

  const response = await ws.compile(sessionId);
  expect(response.status).toBe(200);

  const flow = await prisma.flow.findFirstOrThrow();
  expect(flow.slug).toBe('create-a-whatsapp-template');
});

test('a second flow with the same title gets a -2 slug', async () => {
  const ws = await workspace(await newApp());
  const assetId = await ws.upload();

  const firstSessionId = ((await (await ws.createRun({ title: 'Create a WhatsApp template!' })).json()) as {
    session_id: string;
  }).session_id;
  await ws.addStep(firstSessionId, stepBody(assetId));
  expect((await ws.compile(firstSessionId)).status).toBe(200);

  const secondSessionId = ((await (await ws.createRun({ title: 'Create a WhatsApp template!' })).json()) as {
    session_id: string;
  }).session_id;
  await ws.addStep(secondSessionId, stepBody(assetId));
  expect((await ws.compile(secondSessionId)).status).toBe(200);

  const slugs = (await prisma.flow.findMany({ orderBy: { createdAt: 'asc' } })).map((flow) => flow.slug);
  expect(slugs).toEqual(['create-a-whatsapp-template', 'create-a-whatsapp-template-2']);
});

test('changing the title at a later compile keeps the slug set at first compile', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({ title: 'Original title' })).json()) as {
    session_id: string;
  }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId));
  await ws.compile(sessionId);

  const afterFirst = await prisma.flow.findFirstOrThrow();
  expect(afterFirst.slug).toBe('original-title');

  const flow = await prisma.flow.findFirstOrThrow();
  const secondSessionId = ((await (await ws.createRun({ flow_id: flow.publicId })).json()) as {
    session_id: string;
  }).session_id;
  await ws.addStep(secondSessionId, stepBody(assetId));
  await ws.compile(secondSessionId, { title: 'A brand new title' });

  const afterSecond = await prisma.flow.findFirstOrThrow();
  expect(afterSecond.title).toBe('A brand new title');
  expect(afterSecond.slug).toBe('original-title');
});

test('compile fills the search document from title, summary and step text', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({ title: 'Reset a password' })).json()) as {
    session_id: string;
  }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId, { instruction: 'Open the account template page' }));

  await ws.compile(sessionId);

  const rows = await prisma.$queryRaw<{ matched: boolean }[]>`
    SELECT search @@ to_tsquery('simple', 'template:*') AS matched FROM "Flow" LIMIT 1
  `;
  expect(rows[0]!.matched).toBe(true);
});

test("compiling another workspace's run is 404 and changes nothing", async () => {
  const app = await newApp();
  const owner = await workspace(app);
  const sessionId = ((await (await owner.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await owner.upload();
  expect((await owner.addStep(sessionId, stepBody(assetId))).status).toBe(201);

  const other = await workspace(app, OTHER_GITHUB_ACCOUNT);
  const response = await other.compile(sessionId);

  expect(response.status).toBe(404);
  const run = await prisma.run.findUniqueOrThrow({ where: { publicId: sessionId } });
  expect(run.status).toBe("recording");
  expect((await prisma.flow.findFirstOrThrow()).latestRunId).toBeNull();
});

test('compile with category creates a suggested category and reports status', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId));

  const response = await ws.compile(sessionId, { category: 'WhatsApp' });

  expect(response.status).toBe(200);
  const body = (await response.json()) as { url: string; category_status?: string };
  expect(body.category_status).toBe('suggested');

  const flow = await prisma.flow.findFirstOrThrow();
  expect(flow.categoryId).toBeTruthy();
  const category = await prisma.category.findUniqueOrThrow({
    where: { id: flow.categoryId! },
  });
  expect(category.slug).toBe('whatsapp');
  expect(category.status).toBe('suggested');
  expect(category.source).toBe('agent');
});

test('compile with category under auto policy creates active category and reports filed', async () => {
  const ws = await workspace(await newApp());
  await prisma.workspaceSite.create({
    data: { organizationId: ws.organizationId, siteTitle: 'Site', categoryPolicy: 'auto' },
  });

  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId));

  const response = await ws.compile(sessionId, { category: 'WhatsApp' });

  expect(response.status).toBe(200);
  const body = (await response.json()) as { url: string; category_status?: string };
  expect(body.category_status).toBe('filed');

  const flow = await prisma.flow.findFirstOrThrow();
  const category = await prisma.category.findUniqueOrThrow({
    where: { id: flow.categoryId! },
  });
  expect(category.status).toBe('active');
});

test('a second compile ignores category from body and does not create a new one', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId));

  const first = await ws.compile(sessionId, { category: 'WhatsApp' });
  expect(first.status).toBe(200);
  const firstBody = (await first.json()) as { url: string; category_status?: string };
  expect(firstBody.category_status).toBe('suggested');

  const flow = await prisma.flow.findFirstOrThrow();
  const firstCategoryId = flow.categoryId;
  expect(await prisma.category.count({ where: { organizationId: ws.organizationId } })).toBe(1);

  const second = await ws.compile(sessionId, { category: 'Other' });
  expect(second.status).toBe(200);
  const secondBody = (await second.json()) as { url: string; category_status?: string };
  expect(secondBody.category_status).toBeUndefined();

  const flowAfter = await prisma.flow.findFirstOrThrow();
  expect(flowAfter.categoryId).toBe(firstCategoryId);
  expect(await prisma.category.count({ where: { organizationId: ws.organizationId } })).toBe(1);
});

test('a guide filed by hand (prior category set) keeps it on recompile', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId));

  // Compile with a category
  const firstCompile = await ws.compile(sessionId, { category: 'WhatsApp' });
  expect(firstCompile.status).toBe(200);

  let flow = await prisma.flow.findFirstOrThrow();
  const originalCategoryId = flow.categoryId;
  expect(originalCategoryId).toBeTruthy();

  // Create another flow that was already compiled once, with a categoryId set by hand.
  const otherFlow = await prisma.flow.create({
    data: {
      publicId: 'other-flow-id-1234',
      organizationId: ws.organizationId,
      title: 'Other flow',
      slug: 'other-flow',
    },
  });
  const otherCategory = await prisma.category.create({
    data: {
      organizationId: ws.organizationId,
      slug: 'other-category',
      name: 'Other Category',
      source: 'user',
      status: 'active',
    },
  });
  const otherFirstRun = await prisma.run.create({
    data: { publicId: 'other-flow-run-0001', flowId: otherFlow.id, status: 'compiled', compiledAt: new Date() },
  });
  await prisma.flow.update({
    where: { id: otherFlow.id },
    data: { categoryId: otherCategory.id, latestRunId: otherFirstRun.id },
  });

  // Update this run to point to the other flow and compile again
  await prisma.run.update({
    where: { publicId: sessionId },
    data: { status: 'recording', compiledAt: null },
  });
  await prisma.run.update({
    where: { publicId: sessionId },
    data: { flowId: otherFlow.id },
  });

  const secondCompile = await ws.compile(sessionId, { category: 'NewCategory' });
  expect(secondCompile.status).toBe(200);

  const otherFlowAfter = await prisma.flow.findUniqueOrThrow({ where: { id: otherFlow.id } });
  expect(otherFlowAfter.categoryId).toBe(otherCategory.id);
});

test('a backfilled flow (slug set, never compiled) still files category and summary on its first compile', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId));

  // Simulate a backfill migration that assigned every pre-existing flow a slug
  // directly, without ever running it through compile.
  await prisma.flow.updateMany({
    where: { organizationId: ws.organizationId },
    data: { slug: 'backfilled-flow' },
  });

  const response = await ws.compile(sessionId, { category: 'WhatsApp', summary: 'How to use WhatsApp' });
  expect(response.status).toBe(200);

  const flowAfter = await prisma.flow.findFirstOrThrow({ where: { organizationId: ws.organizationId } });
  expect(flowAfter.summary).toBe('How to use WhatsApp');
  expect(flowAfter.categoryId).toBeTruthy();
});

test('compile with summary stores it and makes it searchable', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({ title: 'How to reset' })).json()) as {
    session_id: string;
  }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId));

  const response = await ws.compile(sessionId, { summary: 'Complete guide to password recovery' });

  expect(response.status).toBe(200);

  const flow = await prisma.flow.findFirstOrThrow();
  expect(flow.summary).toBe('Complete guide to password recovery');

  // Check that summary is searchable
  const rows = await prisma.$queryRaw<{ matched: boolean }[]>`
    SELECT search @@ to_tsquery('simple', 'recovery:*') AS matched FROM "Flow" LIMIT 1
  `;
  expect(rows[0]!.matched).toBe(true);
});

test('compile without category returns only url', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId));

  const response = await ws.compile(sessionId);

  expect(response.status).toBe(200);
  const body = (await response.json()) as Record<string, unknown>;
  expect(body).toHaveProperty('url');
  expect(body).not.toHaveProperty('category_status');
});
