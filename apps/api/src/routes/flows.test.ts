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
  listFlows: (query?: string) => Promise<Response>;
  deleteFlow: (publicId: string) => Promise<Response>;
  getDoc: (publicId: string) => Promise<Response>;
  getMarkdown: (publicId: string) => Promise<Response>;
  getImage: (publicId: string) => Promise<Response>;
};

const newApp = async (): Promise<App> => {
  const root = await mkdtemp(join(tmpdir(), 'od-flows-'));
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
    listFlows: (query) =>
      app.handle(
        new Request(`${BASE_URL}/api/v1/flows${query ? `?${query}` : ''}`, {
          headers: { cookie },
        }),
      ),
    deleteFlow: (publicId) =>
      app.handle(
        new Request(`${BASE_URL}/api/v1/flows/${publicId}`, {
          method: 'DELETE',
          headers: { cookie },
        }),
      ),
    getDoc: (publicId) =>
      app.handle(new Request(`${BASE_URL}/api/v1/docs/${publicId}`)),
    getMarkdown: (publicId) =>
      app.handle(new Request(`${BASE_URL}/api/v1/docs/${publicId}/markdown`)),
    getImage: (publicId) =>
      app.handle(new Request(`${BASE_URL}/i/${publicId}`)),
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

type FlowItem = {
  public_id: string;
  title: string;
  last_run_at: string;
  url: string | null;
  not_redacted: boolean;
};

type CompiledFlow = {
  sessionId: string;
  flowPublicId: string;
  assetPublicId: string;
};

/** Records a run, one step, and compiles it, so a flow lands with a published doc. */
const compiledFlow = async (
  ws: Workspace,
  title: string,
  redaction?: { mode: 'strict' | 'basic' | 'off' },
): Promise<CompiledFlow> => {
  const sessionId = ((await (await ws.createRun({ title })).json()) as { session_id: string }).session_id;
  const assetPublicId = await ws.upload();
  // strict/basic need the in-page script's report, or the step is refused (C3-AC04).
  const withReport =
    redaction && redaction.mode !== 'off'
      ? { ...redaction, report: { count: 1, script_version: '1' } }
      : redaction;
  const step = await ws.addStep(
    sessionId,
    stepBody(assetPublicId, withReport ? { redaction: withReport } : {}),
  );
  expect(step.status).toBe(201);
  expect((await ws.compile(sessionId)).status).toBe(200);

  const run = await prisma.run.findFirstOrThrow({
    where: { publicId: sessionId },
    select: { flow: { select: { publicId: true } } },
  });

  return { sessionId, flowPublicId: run.flow.publicId, assetPublicId };
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

test('lists own flows newest first', async () => {
  const ws = await workspace(await newApp());
  await compiledFlow(ws, 'First flow');
  // Two runs land at different startedAt timestamps, so ordering is deterministic.
  await new Promise((resolve) => setTimeout(resolve, 5));
  await compiledFlow(ws, 'Second flow');

  const response = await ws.listFlows();

  expect(response.status).toBe(200);
  const body = (await response.json()) as { items: FlowItem[]; next_cursor: string | null };
  expect(body.items.map((item) => item.title)).toEqual(['Second flow', 'First flow']);
  expect(body.next_cursor).toBeNull();
});

test('excludes other workspace flows', async () => {
  const app = await newApp();
  const owner = await workspace(app);
  await compiledFlow(owner, 'Owner flow');

  const other = await workspace(app, OTHER_GITHUB_ACCOUNT);
  await compiledFlow(other, 'Other flow');

  const response = await owner.listFlows();
  const body = (await response.json()) as { items: FlowItem[] };
  expect(body.items).toHaveLength(1);
  expect(body.items[0]!.title).toBe('Owner flow');
});

test('flags not_redacted from latest run', async () => {
  const ws = await workspace(await newApp());
  await compiledFlow(ws, 'Unredacted flow', { mode: 'off' });
  await compiledFlow(ws, 'Redacted flow', { mode: 'strict' });

  const response = await ws.listFlows();
  const body = (await response.json()) as { items: FlowItem[] };

  const byTitle = new Map(body.items.map((item) => [item.title, item]));
  expect(byTitle.get('Unredacted flow')?.not_redacted).toBe(true);
  expect(byTitle.get('Redacted flow')?.not_redacted).toBe(false);
  expect(byTitle.get('Redacted flow')?.url).not.toBeNull();
});

test('recording-only flow has null url', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({ title: 'Still recording' })).json()) as {
    session_id: string;
  }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId));

  const response = await ws.listFlows();
  const body = (await response.json()) as { items: FlowItem[] };

  expect(body.items).toHaveLength(1);
  expect(body.items[0]!.url).toBeNull();
  expect(body.items[0]!.title).toBe('Still recording');
});

test('no auth returns 401', async () => {
  const app = await newApp();

  const response = await app.handle(new Request(`${BASE_URL}/api/v1/flows`));

  expect(response.status).toBe(401);
  expect(await errorCode(response)).toBe('unauthorized');
});

test('cursor paginates', async () => {
  const ws = await workspace(await newApp());
  const titles = ['Flow A', 'Flow B', 'Flow C'];
  for (const title of titles) {
    await compiledFlow(ws, title);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const firstPage = await ws.listFlows('limit=2');
  const firstBody = (await firstPage.json()) as { items: FlowItem[]; next_cursor: string | null };
  expect(firstBody.items).toHaveLength(2);
  expect(firstBody.items.map((item) => item.title)).toEqual(['Flow C', 'Flow B']);
  expect(firstBody.next_cursor).toBe(firstBody.items[1]!.public_id);

  const secondPage = await ws.listFlows(`limit=2&cursor=${firstBody.next_cursor}`);
  const secondBody = (await secondPage.json()) as { items: FlowItem[]; next_cursor: string | null };
  expect(secondBody.items.map((item) => item.title)).toEqual(['Flow A']);
  expect(secondBody.next_cursor).toBeNull();
});

test('rejects an invalid limit with 422', async () => {
  const ws = await workspace(await newApp());

  const response = await ws.listFlows('limit=0');

  expect(response.status).toBe(422);
  expect(await errorCode(response)).toBe('validation_failed');
});

test('deletes own flow and expires its assets', async () => {
  const ws = await workspace(await newApp());
  const flow = await compiledFlow(ws, 'Deleted flow');

  const response = await ws.deleteFlow(flow.flowPublicId);

  expect(response.status).toBe(204);

  const dbFlow = await prisma.flow.findUniqueOrThrow({
    where: { publicId: flow.flowPublicId },
    select: { deletedAt: true },
  });
  expect(dbFlow.deletedAt).not.toBeNull();

  const asset = await prisma.asset.findUniqueOrThrow({
    where: { publicId: flow.assetPublicId },
    select: { expiresAt: true },
  });
  expect(asset.expiresAt).not.toBeNull();
  expect(asset.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now());
});

test("returns 404 for another workspace's flow", async () => {
  const app = await newApp();
  const owner = await workspace(app);
  const flow = await compiledFlow(owner, 'Owner flow');

  const other = await workspace(app, OTHER_GITHUB_ACCOUNT);
  const response = await other.deleteFlow(flow.flowPublicId);

  expect(response.status).toBe(404);
  expect(await errorCode(response)).toBe('not_found');

  const dbFlow = await prisma.flow.findUniqueOrThrow({
    where: { publicId: flow.flowPublicId },
    select: { deletedAt: true },
  });
  expect(dbFlow.deletedAt).toBeNull();
});

test('second delete is idempotent', async () => {
  const ws = await workspace(await newApp());
  const flow = await compiledFlow(ws, 'Deleted twice');

  const first = await ws.deleteFlow(flow.flowPublicId);
  expect(first.status).toBe(204);

  const firstDeletedAt = (
    await prisma.flow.findUniqueOrThrow({
      where: { publicId: flow.flowPublicId },
      select: { deletedAt: true },
    })
  ).deletedAt;

  const second = await ws.deleteFlow(flow.flowPublicId);
  expect(second.status).toBe(204);

  const secondDeletedAt = (
    await prisma.flow.findUniqueOrThrow({
      where: { publicId: flow.flowPublicId },
      select: { deletedAt: true },
    })
  ).deletedAt;
  expect(secondDeletedAt).toEqual(firstDeletedAt);
});

test("deleted flow's doc returns 404", async () => {
  const ws = await workspace(await newApp());
  const flow = await compiledFlow(ws, 'Flow with a doc');

  expect((await ws.deleteFlow(flow.flowPublicId)).status).toBe(204);

  expect((await ws.getDoc(flow.flowPublicId)).status).toBe(404);
  expect((await ws.getMarkdown(flow.flowPublicId)).status).toBe(404);
  expect((await ws.getImage(flow.assetPublicId)).status).toBe(410);
});

test('deleting without auth returns 401', async () => {
  const app = await newApp();

  const response = await app.handle(
    new Request(`${BASE_URL}/api/v1/flows/0000000000000000`, { method: 'DELETE' }),
  );

  expect(response.status).toBe(401);
  expect(await errorCode(response)).toBe('unauthorized');
});

test('new fields slug, summary, visibility, steps, category are present', async () => {
  const ws = await workspace(await newApp());
  const flow = await compiledFlow(ws, 'Test flow');
  const updated = await prisma.flow.update({
    where: { publicId: flow.flowPublicId },
    data: { summary: 'Test summary' },
  });

  const response = await ws.listFlows();
  const body = (await response.json()) as {
    items: Array<{ slug: string; summary: string | null; visibility: string; steps: number; category: unknown }>;
  };

  expect(body.items).toHaveLength(1);
  expect(body.items[0]!.slug).toBeDefined();
  expect(body.items[0]!.summary).toBe('Test summary');
  expect(body.items[0]!.visibility).toBe('published');
  expect(body.items[0]!.steps).toBeGreaterThanOrEqual(0);
  expect(body.items[0]!.category).toBeNull();
});

test('q filter matches title case-insensitively', async () => {
  const ws = await workspace(await newApp());
  await compiledFlow(ws, 'Finding Nemo');
  await compiledFlow(ws, 'Shrek');

  const response = await ws.listFlows('q=nemo');

  expect(response.status).toBe(200);
  const body = (await response.json()) as { items: FlowItem[] };
  expect(body.items).toHaveLength(1);
  expect(body.items[0]!.title).toBe('Finding Nemo');
});

test('category filter by id', async () => {
  const ws = await workspace(await newApp());
  const category = await prisma.category.create({
    data: { organizationId: ws.organizationId, name: 'Test Category', slug: 'test', status: 'active' },
  });
  const flow = await compiledFlow(ws, 'Categorized flow');
  await prisma.flow.update({
    where: { publicId: flow.flowPublicId },
    data: { categoryId: category.id },
  });
  await compiledFlow(ws, 'Uncategorized flow');

  const response = await ws.listFlows(`category=${category.id}`);

  expect(response.status).toBe(200);
  const body = (await response.json()) as { items: FlowItem[] };
  expect(body.items).toHaveLength(1);
  expect(body.items[0]!.title).toBe('Categorized flow');
});

test('category filter with none', async () => {
  const ws = await workspace(await newApp());
  const category = await prisma.category.create({
    data: { organizationId: ws.organizationId, name: 'Test Category', slug: 'test', status: 'active' },
  });
  const flow = await compiledFlow(ws, 'Categorized flow');
  await prisma.flow.update({
    where: { publicId: flow.flowPublicId },
    data: { categoryId: category.id },
  });
  await compiledFlow(ws, 'Uncategorized flow');

  const response = await ws.listFlows('category=none');

  expect(response.status).toBe(200);
  const body = (await response.json()) as { items: FlowItem[] };
  expect(body.items).toHaveLength(1);
  expect(body.items[0]!.title).toBe('Uncategorized flow');
});

test('visibility filter', async () => {
  const ws = await workspace(await newApp());
  const flow1 = await compiledFlow(ws, 'Published flow');
  await prisma.flow.update({
    where: { publicId: flow1.flowPublicId },
    data: { visibility: 'draft' },
  });
  const flow2 = await compiledFlow(ws, 'Unlisted flow');
  await prisma.flow.update({
    where: { publicId: flow2.flowPublicId },
    data: { visibility: 'unlisted' },
  });

  const response = await ws.listFlows('visibility=unlisted');

  expect(response.status).toBe(200);
  const body = (await response.json()) as { items: FlowItem[] };
  expect(body.items).toHaveLength(1);
  expect(body.items[0]!.title).toBe('Unlisted flow');
});

test('bad visibility returns 422', async () => {
  const ws = await workspace(await newApp());

  const response = await ws.listFlows('visibility=invalid');

  expect(response.status).toBe(422);
  expect(await errorCode(response)).toBe('validation_failed');
});

test('public_id filter returns only that flow', async () => {
  const ws = await workspace(await newApp());
  const flow1 = await compiledFlow(ws, 'First flow');
  const flow2 = await compiledFlow(ws, 'Second flow');

  const response = await ws.listFlows(`public_id=${flow1.flowPublicId}`);

  expect(response.status).toBe(200);
  const body = (await response.json()) as { items: FlowItem[] };
  expect(body.items).toHaveLength(1);
  expect(body.items[0]!.public_id).toBe(flow1.flowPublicId);
});

test('public_id filter with unknown id returns empty list', async () => {
  const ws = await workspace(await newApp());
  await compiledFlow(ws, 'Flow');

  const response = await ws.listFlows('public_id=unknown123');

  expect(response.status).toBe(200);
  const body = (await response.json()) as { items: FlowItem[] };
  expect(body.items).toHaveLength(0);
});

test('public_id filter excludes another workspace flow', async () => {
  const app = await newApp();
  const owner = await workspace(app);
  const flow = await compiledFlow(owner, 'Owner flow');

  const other = await workspace(app, OTHER_GITHUB_ACCOUNT);
  const response = await other.listFlows(`public_id=${flow.flowPublicId}`);

  expect(response.status).toBe(200);
  const body = (await response.json()) as { items: FlowItem[] };
  expect(body.items).toHaveLength(0);
});

test('filters combine with cursor', async () => {
  const ws = await workspace(await newApp());
  const titles = ['Alpha Draft', 'Beta Draft', 'Gamma Published'];
  for (const title of titles) {
    const flow = await compiledFlow(ws, title);
    if (!title.includes('Published')) {
      await prisma.flow.update({
        where: { publicId: flow.flowPublicId },
        data: { visibility: 'draft' },
      });
    }
  }

  const response = await ws.listFlows('visibility=draft&limit=1');

  expect(response.status).toBe(200);
  const body = (await response.json()) as { items: FlowItem[]; next_cursor: string | null };
  expect(body.items).toHaveLength(1);
  expect(body.next_cursor).not.toBeNull();

  const secondResponse = await ws.listFlows(`visibility=draft&limit=1&cursor=${body.next_cursor}`);
  const secondBody = (await secondResponse.json()) as { items: FlowItem[] };
  expect(secondBody.items).toHaveLength(1);
  expect(secondBody.items[0]!.title).not.toBe(body.items[0]!.title);
});
