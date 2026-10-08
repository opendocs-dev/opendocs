import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import {
  BASE_URL,
  cleanDatabase,
  memoryStorage,
  realFetch,
  signIn,
  type App,
} from '../../test/helpers';
import { tinyPng } from '../../test/images';
import { getPrisma } from '../db';
import { resetEnvForTest } from '../env';
import { createApp } from '../index';

const prisma = getPrisma();

type Workspace = {
  app: App;
  cookie: string;
  organizationId: string;
  upload: () => Promise<string>;
  createRun: (body?: unknown) => Promise<Response>;
  addStep: (sessionId: string, body: unknown) => Promise<Response>;
  compile: (sessionId: string, body?: unknown) => Promise<Response>;
  patchFlow: (publicId: string, body: unknown) => Promise<Response>;
  bulkUpdate: (body: unknown) => Promise<Response>;
  getOverview: () => Promise<Response>;
};

const newApp = async (): Promise<App> => {
  return createApp(async () => {}, memoryStorage());
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

  const patch = (path: string, body: unknown) =>
    app.handle(
      new Request(`${BASE_URL}${path}`, {
        method: 'PATCH',
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
    patchFlow: (publicId, body) => patch(`/api/v1/flows/${publicId}`, body),
    bulkUpdate: (body) => post('/api/v1/flows/bulk', body),
    getOverview: () =>
      app.handle(
        new Request(`${BASE_URL}/api/v1/overview`, {
          headers: { cookie },
        }),
      ),
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

const compiledFlow = async (ws: Workspace, title: string) => {
  const sessionId = ((await (await ws.createRun({ title })).json()) as { session_id: string }).session_id;
  const assetPublicId = await ws.upload();
  const step = await ws.addStep(sessionId, stepBody(assetPublicId, { redaction: { mode: 'off', report: { count: 1, script_version: '1' } } }));
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

test('PATCH changes title and updates search', async () => {
  const ws = await workspace(await newApp());
  const flow = await compiledFlow(ws, 'Original Title');

  const response = await ws.patchFlow(flow.flowPublicId, { title: 'New Title' });

  expect(response.status).toBe(200);
  const body = (await response.json()) as { ok: boolean };
  expect(body.ok).toBe(true);

  const updated = await prisma.flow.findUniqueOrThrow({
    where: { publicId: flow.flowPublicId },
    select: { title: true },
  });
  expect(updated.title).toBe('New Title');
});

test('PATCH changes summary', async () => {
  const ws = await workspace(await newApp());
  const flow = await compiledFlow(ws, 'Test Flow');

  const response = await ws.patchFlow(flow.flowPublicId, { summary: 'New summary' });

  expect(response.status).toBe(200);
  const updated = await prisma.flow.findUniqueOrThrow({
    where: { publicId: flow.flowPublicId },
    select: { summary: true },
  });
  expect(updated.summary).toBe('New summary');
});

test('PATCH changes visibility', async () => {
  const ws = await workspace(await newApp());
  const flow = await compiledFlow(ws, 'Test Flow');

  const response = await ws.patchFlow(flow.flowPublicId, { visibility: 'draft' });

  expect(response.status).toBe(200);
  const updated = await prisma.flow.findUniqueOrThrow({
    where: { publicId: flow.flowPublicId },
    select: { visibility: true },
  });
  expect(updated.visibility).toBe('draft');
});

test('PATCH changes seo_title, seo_description and noindex', async () => {
  const ws = await workspace(await newApp());
  const flow = await compiledFlow(ws, 'Test Flow');

  const response = await ws.patchFlow(flow.flowPublicId, {
    seo_title: 'Custom SEO Title',
    seo_description: 'Custom SEO description',
    noindex: true,
  });

  expect(response.status).toBe(200);
  const updated = await prisma.flow.findUniqueOrThrow({
    where: { publicId: flow.flowPublicId },
    select: { seoTitle: true, seoDescription: true, noindex: true },
  });
  expect(updated.seoTitle).toBe('Custom SEO Title');
  expect(updated.seoDescription).toBe('Custom SEO description');
  expect(updated.noindex).toBe(true);
});

test('PATCH clears seo_title and seo_description back to null with an empty string', async () => {
  const ws = await workspace(await newApp());
  const flow = await compiledFlow(ws, 'Test Flow');
  await ws.patchFlow(flow.flowPublicId, { seo_title: 'Something', seo_description: 'Something else' });

  const response = await ws.patchFlow(flow.flowPublicId, { seo_title: '', seo_description: '' });

  expect(response.status).toBe(200);
  const updated = await prisma.flow.findUniqueOrThrow({
    where: { publicId: flow.flowPublicId },
    select: { seoTitle: true, seoDescription: true },
  });
  expect(updated.seoTitle).toBeNull();
  expect(updated.seoDescription).toBeNull();
});

test('PATCH with seo_title over 60 characters returns 422', async () => {
  const ws = await workspace(await newApp());
  const flow = await compiledFlow(ws, 'Test Flow');

  const response = await ws.patchFlow(flow.flowPublicId, { seo_title: 'x'.repeat(61) });

  expect(response.status).toBe(422);
});

test('PATCH with seo_description over 160 characters returns 422', async () => {
  const ws = await workspace(await newApp());
  const flow = await compiledFlow(ws, 'Test Flow');

  const response = await ws.patchFlow(flow.flowPublicId, { seo_description: 'x'.repeat(161) });

  expect(response.status).toBe(422);
});

test('PATCH with non-boolean noindex returns 422', async () => {
  const ws = await workspace(await newApp());
  const flow = await compiledFlow(ws, 'Test Flow');

  const response = await ws.patchFlow(flow.flowPublicId, { noindex: 'yes' });

  expect(response.status).toBe(422);
});

test('PATCH changes slug and lowercases it', async () => {
  const ws = await workspace(await newApp());
  const flow = await compiledFlow(ws, 'Test Flow');

  const response = await ws.patchFlow(flow.flowPublicId, { slug: 'Custom-New-Slug' });

  expect(response.status).toBe(200);
  const updated = await prisma.flow.findUniqueOrThrow({
    where: { publicId: flow.flowPublicId },
    select: { slug: true },
  });
  expect(updated.slug).toBe('custom-new-slug');
});

test('PATCH with the same slug on the same flow succeeds', async () => {
  const ws = await workspace(await newApp());
  const flow = await compiledFlow(ws, 'Test Flow');

  const current = await prisma.flow.findUniqueOrThrow({
    where: { publicId: flow.flowPublicId },
    select: { slug: true },
  });

  const response = await ws.patchFlow(flow.flowPublicId, { slug: current.slug });
  expect(response.status).toBe(200);
});

test('PATCH with invalid slug format returns 422', async () => {
  const ws = await workspace(await newApp());
  const flow = await compiledFlow(ws, 'Test Flow');

  const invalidSlugs = [
    '',
    '   ',
    'has space',
    '-leading-hyphen',
    'trailing-hyphen-',
    'double--hyphens',
    'special@char',
    'a'.repeat(61),
  ];

  for (const slug of invalidSlugs) {
    const response = await ws.patchFlow(flow.flowPublicId, { slug });
    expect(response.status).toBe(422);
  }
});

test('PATCH with duplicate slug in the same workspace returns 409', async () => {
  const ws = await workspace(await newApp());
  const flow1 = await compiledFlow(ws, 'Flow One');
  const flow2 = await compiledFlow(ws, 'Flow Two');

  const flow1Slug = (
    await prisma.flow.findUniqueOrThrow({
      where: { publicId: flow1.flowPublicId },
      select: { slug: true },
    })
  ).slug;

  const response = await ws.patchFlow(flow2.flowPublicId, { slug: flow1Slug });
  expect(response.status).toBe(409);
  expect(await errorCode(response)).toBe('validation_failed');
});

test('PATCH without any field returns 422', async () => {
  const ws = await workspace(await newApp());
  const flow = await compiledFlow(ws, 'Test Flow');

  const response = await ws.patchFlow(flow.flowPublicId, {});

  expect(response.status).toBe(422);
});

test('PATCH with invalid title length returns 422', async () => {
  const ws = await workspace(await newApp());
  const flow = await compiledFlow(ws, 'Test Flow');

  const response = await ws.patchFlow(flow.flowPublicId, { title: 'a'.repeat(121) });

  expect(response.status).toBe(422);
});

test('PATCH with invalid visibility returns 422', async () => {
  const ws = await workspace(await newApp());
  const flow = await compiledFlow(ws, 'Test Flow');

  const response = await ws.patchFlow(flow.flowPublicId, { visibility: 'invalid' });

  expect(response.status).toBe(422);
});

test('PATCH returns 404 for deleted flow', async () => {
  const ws = await workspace(await newApp());
  const flow = await compiledFlow(ws, 'Test Flow');

  await prisma.flow.update({
    where: { publicId: flow.flowPublicId },
    data: { deletedAt: new Date() },
  });

  const response = await ws.patchFlow(flow.flowPublicId, { title: 'New Title' });

  expect(response.status).toBe(404);
});

test('bulk update sets category and visibility', async () => {
  const ws = await workspace(await newApp());
  const flow1 = await compiledFlow(ws, 'Flow 1');
  const flow2 = await compiledFlow(ws, 'Flow 2');
  const category = await prisma.category.create({
    data: { organizationId: ws.organizationId, name: 'Test', slug: 'test', status: 'active' },
  });

  const response = await ws.bulkUpdate({
    ids: [flow1.flowPublicId, flow2.flowPublicId],
    category_id: category.id,
    visibility: 'draft',
  });

  expect(response.status).toBe(200);
  const body = (await response.json()) as { updated: number };
  expect(body.updated).toBe(2);

  const updated1 = await prisma.flow.findUniqueOrThrow({
    where: { publicId: flow1.flowPublicId },
  });
  expect(updated1.categoryId).toBe(category.id);
  expect(updated1.visibility).toBe('draft');
});

test('bulk update rejects more than 50 ids', async () => {
  const ws = await workspace(await newApp());

  const ids = Array.from({ length: 51 }, (_, i) => `id${i}`);
  const response = await ws.bulkUpdate({ ids, visibility: 'draft' });

  expect(response.status).toBe(422);
});

test('bulk update accepts category_id: null', async () => {
  const ws = await workspace(await newApp());
  const category = await prisma.category.create({
    data: { organizationId: ws.organizationId, name: 'Test', slug: 'test', status: 'active' },
  });
  const flow = await compiledFlow(ws, 'Flow');
  await prisma.flow.update({
    where: { publicId: flow.flowPublicId },
    data: { categoryId: category.id },
  });

  const response = await ws.bulkUpdate({
    ids: [flow.flowPublicId],
    category_id: null,
  });

  expect(response.status).toBe(200);
  const updated = await prisma.flow.findUniqueOrThrow({
    where: { publicId: flow.flowPublicId },
  });
  expect(updated.categoryId).toBeNull();
});

test('overview counts compiled flows by visibility', async () => {
  const ws = await workspace(await newApp());
  const published = await compiledFlow(ws, 'Published');
  const unlisted = await compiledFlow(ws, 'Unlisted');
  const draft = await compiledFlow(ws, 'Draft');

  await prisma.flow.update({
    where: { publicId: unlisted.flowPublicId },
    data: { visibility: 'unlisted' },
  });
  await prisma.flow.update({
    where: { publicId: draft.flowPublicId },
    data: { visibility: 'draft' },
  });

  const response = await ws.getOverview();

  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    published: number;
    unlisted: number;
    draft: number;
    has_guide: boolean;
  };
  expect(body.published).toBe(1);
  expect(body.unlisted).toBe(1);
  expect(body.draft).toBe(1);
  expect(body.has_guide).toBe(true);
});

test('overview has_key reflects API keys', async () => {
  const ws = await workspace(await newApp());

  const noKeyResponse = await ws.getOverview();
  const noKeyBody = (await noKeyResponse.json()) as { has_key: boolean };
  expect(noKeyBody.has_key).toBe(false);

  // Create a key
  await prisma.apikey.create({
    data: {
      id: 'key1',
      referenceId: ws.organizationId,
      key: 'test-key',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  const withKeyResponse = await ws.getOverview();
  const withKeyBody = (await withKeyResponse.json()) as { has_key: boolean };
  expect(withKeyBody.has_key).toBe(true);
});

test('overview storage_used is 0% without a storage cap and has no site_host', async () => {
  const ws = await workspace(await newApp());
  await compiledFlow(ws, 'Flow');

  const response = await ws.getOverview();

  expect(response.status).toBe(200);
  const body = (await response.json()) as { storage_used: string; site_host?: string };
  expect(body.storage_used).toBe('0%');
  expect(body.site_host).toBeUndefined();
});

test('overview storage_used is a percentage when STORAGE_QUOTA_BYTES is set', async () => {
  const ws = await workspace(await newApp());
  await compiledFlow(ws, 'Flow');

  const oldQuota = process.env.STORAGE_QUOTA_BYTES;
  process.env.STORAGE_QUOTA_BYTES = '1000';
  resetEnvForTest();

  try {
    const response = await ws.getOverview();
    const body = (await response.json()) as { storage_used: string };
    expect(body.storage_used).toMatch(/^\d+%$/);
    expect(body.storage_used).not.toBe('0%');
  } finally {
    if (oldQuota === undefined) delete process.env.STORAGE_QUOTA_BYTES;
    else process.env.STORAGE_QUOTA_BYTES = oldQuota;
    resetEnvForTest();
  }
});
