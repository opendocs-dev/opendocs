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
  upload: () => Promise<string>;
  createRun: (body?: unknown) => Promise<Response>;
  addStep: (sessionId: string, body: unknown) => Promise<Response>;
  compile: (sessionId: string, body?: unknown) => Promise<Response>;
  getStatus: (query?: string) => Promise<Response>;
};

const newApp = async (): Promise<App> => {
  const root = await mkdtemp(join(tmpdir(), 'od-recording-status-'));
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
    getStatus: (query = '') =>
      app.handle(
        new Request(`${BASE_URL}/api/v1/recording-status${query ? `?${query}` : ''}`, {
          headers: { cookie },
        }),
      ),
  };
};

const stepBody = (assetId: string) => ({
  asset_id: assetId,
  action: 'click',
  selector: '#save',
  instruction: 'Click Save',
  redaction: { mode: 'off', report: { count: 1, script_version: '1' } },
});

beforeEach(async () => {
  await cleanDatabase();
});

afterEach(async () => {
  await cleanDatabase();
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

test('unauthenticated request returns 401', async () => {
  const app = await newApp();
  const response = await app.handle(new Request(`${BASE_URL}/api/v1/recording-status`));
  expect(response.status).toBe(401);
});

test('empty workspace returns disconnected status with no recording', async () => {
  const ws = await workspace(await newApp());
  const response = await ws.getStatus();
  expect(response.status).toBe(200);

  const body = (await response.json()) as {
    connected: boolean;
    has_key: boolean;
    key_name: string | null;
    key_last_used: string | null;
    recording_started: boolean;
    steps_count: number;
    compile_state: string;
    guide_id: string | null;
  };

  expect(body.connected).toBe(false);
  expect(body.has_key).toBe(false);
  expect(body.recording_started).toBe(false);
  expect(body.steps_count).toBe(0);
  expect(body.compile_state).toBe('none');
  expect(body.guide_id).toBeNull();
});

test('workspace isolation: workspace A recording and keys are never visible to workspace B', async () => {
  const app = await newApp();
  const wsA = await workspace(app);
  const wsB = await workspace(app, OTHER_GITHUB_ACCOUNT);

  // wsA has an API key used 5 minutes ago
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  await prisma.apikey.create({
    data: {
      id: 'key_ws_a',
      referenceId: wsA.organizationId,
      name: 'Agent Key A',
      key: 'key_val_a',
      lastRequest: fiveMinAgo,
      createdAt: fiveMinAgo,
      updatedAt: fiveMinAgo,
    },
  });

  // wsA creates a run and adds 2 steps
  const createRes = await wsA.createRun({ title: 'Workspace A Guide' });
  expect(createRes.status).toBe(201);
  const { session_id } = (await createRes.json()) as { session_id: string };

  const asset1 = await wsA.upload();
  const asset2 = await wsA.upload();
  await wsA.addStep(session_id, stepBody(asset1));
  await wsA.addStep(session_id, stepBody(asset2));

  // Verify wsB sees nothing from wsA
  const resB = await wsB.getStatus();
  expect(resB.status).toBe(200);
  const bodyB = (await resB.json()) as {
    connected: boolean;
    has_key: boolean;
    recording_started: boolean;
    steps_count: number;
    compile_state: string;
    guide_id: string | null;
  };

  expect(bodyB.connected).toBe(false);
  expect(bodyB.has_key).toBe(false);
  expect(bodyB.recording_started).toBe(false);
  expect(bodyB.steps_count).toBe(0);
  expect(bodyB.compile_state).toBe('none');
  expect(bodyB.guide_id).toBeNull();

  // Verify wsA sees its own recording and key
  const resA = await wsA.getStatus();
  expect(resA.status).toBe(200);
  const bodyA = (await resA.json()) as {
    connected: boolean;
    has_key: boolean;
    key_name: string | null;
    key_last_used: string | null;
    recording_started: boolean;
    steps_count: number;
    compile_state: string;
    guide_id: string | null;
  };

  expect(bodyA.connected).toBe(true);
  expect(bodyA.has_key).toBe(true);
  expect(bodyA.key_name).toBe('Agent Key A');
  expect(bodyA.key_last_used).toBe(fiveMinAgo.toISOString());
  expect(bodyA.recording_started).toBe(true);
  expect(bodyA.steps_count).toBe(2);
  expect(bodyA.compile_state).toBe('none');

  // wsA compiles the run
  const compileRes = await wsA.compile(session_id, { title: 'Workspace A Guide Compiled' });
  expect(compileRes.status).toBe(200);

  const resACompiled = await wsA.getStatus();
  const bodyACompiled = (await resACompiled.json()) as {
    compile_state: string;
    guide_id: string | null;
  };
  expect(bodyACompiled.compile_state).toBe('done');
  expect(bodyACompiled.guide_id).toBeTruthy();

  // wsB is still isolated after wsA compile
  const resBAfter = await wsB.getStatus();
  const bodyBAfter = (await resBAfter.json()) as {
    compile_state: string;
    guide_id: string | null;
  };
  expect(bodyBAfter.compile_state).toBe('none');
  expect(bodyBAfter.guide_id).toBeNull();
});

test('records progression: key connected -> recording started -> steps count -> compile done', async () => {
  const ws = await workspace(await newApp());

  // 1. Initial state: disconnected
  let res = await ws.getStatus();
  let body = await res.json() as Record<string, unknown>;
  expect(body.connected).toBe(false);
  expect(body.recording_started).toBe(false);

  // 2. Add API key with recent request
  const usedAt = new Date(Date.now() - 2 * 60 * 1000);
  await prisma.apikey.create({
    data: {
      id: 'support_agent_key',
      referenceId: ws.organizationId,
      name: 'Support agent key',
      key: 'key_support',
      lastRequest: usedAt,
      createdAt: usedAt,
      updatedAt: usedAt,
    },
  });

  res = await ws.getStatus();
  body = await res.json() as Record<string, unknown>;
  expect(body.connected).toBe(true);
  expect(body.has_key).toBe(true);
  expect(body.key_name).toBe('Support agent key');
  expect(body.recording_started).toBe(false);

  // 3. Start recording
  const runRes = await ws.createRun({ title: 'New Onboarding Guide' });
  const { session_id } = (await runRes.json()) as { session_id: string };

  res = await ws.getStatus();
  body = await res.json() as Record<string, unknown>;
  expect(body.recording_started).toBe(true);
  expect(body.steps_count).toBe(0);
  expect(body.compile_state).toBe('none');

  // 4. Add steps
  const asset = await ws.upload();
  await ws.addStep(session_id, stepBody(asset));

  res = await ws.getStatus();
  body = await res.json() as Record<string, unknown>;
  expect(body.steps_count).toBe(1);

  // 5. Compile
  await ws.compile(session_id, { title: 'Compiled Guide' });

  res = await ws.getStatus();
  body = await res.json() as Record<string, unknown>;
  expect(body.compile_state).toBe('done');
  expect(typeof body.guide_id).toBe('string');
});
