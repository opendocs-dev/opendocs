import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { BASE_URL, cleanDatabase, OTHER_GITHUB_ACCOUNT, realFetch, signIn, type App } from '../../test/helpers';
import { tinyPng } from '../../test/images';
import { getPrisma } from '../db';
import { createApp } from '../index';
import { LocalDiskProvider } from '../storage/local';

const prisma = getPrisma();

type Workspace = {
  app: App;
  cookie: string;
  organizationId: string;
  workspaceSlug: string;
  upload: () => Promise<string>;
  createRun: (body?: unknown) => Promise<Response>;
  addStep: (sessionId: string, body: unknown) => Promise<Response>;
  compile: (sessionId: string, body?: unknown) => Promise<Response>;
};

const newApp = async (): Promise<App> => {
  const root = await mkdtemp(join(tmpdir(), 'od-site-public-'));
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
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.activeOrganizationId! },
  });

  return {
    app,
    cookie,
    organizationId: organization.id,
    workspaceSlug: organization.slug,
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

/** Creates a compiled flow with one step and returns its Flow row. */
const compiledGuide = async (
  ws: Workspace,
  title: string,
  instruction = 'Click Save',
  compileOverrides?: Record<string, unknown>,
) => {
  const assetId = await ws.upload();
  const sessionId = ((await (await ws.createRun({ title })).json()) as { session_id: string }).session_id;
  await ws.addStep(sessionId, stepBody(assetId, { instruction }));
  await ws.compile(sessionId, compileOverrides);
  const run = await prisma.run.findUniqueOrThrow({ where: { publicId: sessionId } });
  return prisma.flow.findUniqueOrThrow({ where: { id: run.flowId } });
};

const siteInfo = (app: App, slug: string) =>
  app.handle(new Request(`${BASE_URL}/api/v1/site/${encodeURIComponent(slug)}/info`));

const listGuides = (app: App, slug: string, query = '') =>
  app.handle(new Request(`${BASE_URL}/api/v1/site/${encodeURIComponent(slug)}/guides${query}`));

const search = (app: App, slug: string, q: string, category?: string) =>
  app.handle(
    new Request(
      `${BASE_URL}/api/v1/site/${encodeURIComponent(slug)}/search?q=${encodeURIComponent(q)}${
        category ? `&category=${encodeURIComponent(category)}` : ''
      }`,
    ),
  );

const getGuide = (app: App, slug: string, guideSlug: string) =>
  app.handle(new Request(`${BASE_URL}/api/v1/site/${encodeURIComponent(slug)}/guides/${encodeURIComponent(guideSlug)}`));

const getCategories = (app: App, slug: string) =>
  app.handle(new Request(`${BASE_URL}/api/v1/site/${encodeURIComponent(slug)}/categories`));

const getCanonical = (app: App, publicId: string) =>
  app.handle(new Request(`${BASE_URL}/api/v1/docs/${encodeURIComponent(publicId)}/canonical`));

const errorBody = async (response: Response) =>
  (await response.json()) as { error: { code: string; message: string } };

beforeEach(async () => {
  await cleanDatabase();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  await cleanDatabase();
});

test('site info falls back to the organization name and counts only listed guides', async () => {
  const app = await newApp();
  const ws = await workspace(app);
  await compiledGuide(ws, 'Listed guide');
  const unlisted = await compiledGuide(ws, 'Unlisted guide');
  await prisma.flow.update({ where: { id: unlisted.id }, data: { visibility: 'unlisted' } });

  const response = await siteInfo(app, ws.workspaceSlug);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('public, max-age=30');

  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: ws.organizationId } });
  const body = (await response.json()) as {
    title: string;
    tagline: string;
    preset: string;
    indexing: boolean;
    is_free_plan: boolean;
    guides: number;
  };
  expect(body.title).toBe(organization.name);
  expect(body.tagline).toBe('');
  expect(body.preset).toBe('sage');
  expect(body.indexing).toBe(true);
  expect(body.is_free_plan).toBe(true);
  expect(body.guides).toBe(1);
});

test('site info uses the WorkspaceSite title when one has been set', async () => {
  const app = await newApp();
  const ws = await workspace(app);
  await prisma.workspaceSite.create({
    data: { organizationId: ws.organizationId, siteTitle: 'Custom Title', tagline: 'A tagline', indexing: false },
  });

  const body = (await (await siteInfo(app, ws.workspaceSlug)).json()) as { title: string; tagline: string; indexing: boolean };
  expect(body.title).toBe('Custom Title');
  expect(body.tagline).toBe('A tagline');
  expect(body.indexing).toBe(false);
});

test('site info exposes description, favicon, share image and custom meta', async () => {
  const app = await newApp();
  const ws = await workspace(app);
  const favicon = await prisma.asset.create({
    data: {
      publicId: 'faviconpub01',
      organizationId: ws.organizationId,
      kind: 'brand',
      provider: 'local',
      providerAccount: 'local',
      providerFileId: crypto.randomUUID(),
      mime: 'image/png',
      bytes: 100,
      width: 32,
      height: 32,
      sha256: 'c'.repeat(64),
      expiresAt: null,
    },
  });
  await prisma.workspaceSite.create({
    data: {
      organizationId: ws.organizationId,
      siteTitle: 'Custom Title',
      description: 'A helpful site',
      faviconAssetId: favicon.id,
      customMeta: [{ name: 'theme-color', content: '#0f6b54' }],
    },
  });

  const body = (await (await siteInfo(app, ws.workspaceSlug)).json()) as {
    description: string;
    favicon_url: string | null;
    og_image_url: string | null;
    custom_meta: { name: string; content: string }[];
  };
  expect(body.description).toBe('A helpful site');
  expect(body.favicon_url).toBe(`${process.env.ASSET_BASE_URL}/i/${favicon.publicId}`);
  expect(body.og_image_url).toBeNull();
  expect(body.custom_meta).toEqual([{ name: 'theme-color', content: '#0f6b54' }]);
});

test('site info defaults description to empty and favicon/og/custom_meta to empty when unset', async () => {
  const app = await newApp();
  const ws = await workspace(app);

  const body = (await (await siteInfo(app, ws.workspaceSlug)).json()) as {
    description: string;
    favicon_url: string | null;
    og_image_url: string | null;
    custom_meta: { name: string; content: string }[];
  };
  expect(body.description).toBe('');
  expect(body.favicon_url).toBeNull();
  expect(body.og_image_url).toBeNull();
  expect(body.custom_meta).toEqual([]);
});

test('site info returns custom branding for enterprise workspace and null for non-enterprise', async () => {
  const app = await newApp();
  const ws = await workspace(app);

  await prisma.workspaceSite.create({
    data: {
      organizationId: ws.organizationId,
      siteTitle: 'Branded Site',
      accent: '#6B2FBF',
      mark: '#FFD54A',
      font: 'DM Sans',
      radius: 10,
    },
  });

  // On free plan: custom branding is null
  const freeBody = (await (await siteInfo(app, ws.workspaceSlug)).json()) as {
    accent: string | null;
    mark: string | null;
    font: string | null;
    radius: number | null;
  };
  expect(freeBody.accent).toBeNull();
  expect(freeBody.mark).toBeNull();
  expect(freeBody.font).toBeNull();
  expect(freeBody.radius).toBeNull();

  // Upgrade to enterprise plan: custom branding is returned
  await prisma.workspaceBilling.create({
    data: { organizationId: ws.organizationId, plan: 'enterprise' },
  });

  const entBody = (await (await siteInfo(app, ws.workspaceSlug)).json()) as {
    accent: string | null;
    mark: string | null;
    font: string | null;
    radius: number | null;
  };
  expect(entBody.accent).toBe('#6B2FBF');
  expect(entBody.mark).toBe('#FFD54A');
  expect(entBody.font).toBe('DM Sans');
  expect(entBody.radius).toBe(10);
});

test('site info for an unknown or suspended workspace is the same 404', async () => {
  const app = await newApp();
  const ws = await workspace(app);
  await prisma.organization.update({ where: { id: ws.organizationId }, data: { suspendedAt: new Date() } });

  const suspended = await siteInfo(app, ws.workspaceSlug);
  const unknown = await siteInfo(app, 'totally-unknown-workspace');

  expect(suspended.status).toBe(unknown.status);
  expect(await errorBody(suspended)).toEqual(await errorBody(unknown));
});

test('lists only published, compiled flows ordered by lastRunAt desc', async () => {
  const app = await newApp();
  const ws = await workspace(app);

  const older = await compiledGuide(ws, 'Older guide');
  await new Promise((resolve) => setTimeout(resolve, 5));
  const newer = await compiledGuide(ws, 'Newer guide');

  const unlisted = await compiledGuide(ws, 'Unlisted guide');
  await prisma.flow.update({ where: { id: unlisted.id }, data: { visibility: 'unlisted' } });

  const draft = await compiledGuide(ws, 'Draft guide');
  await prisma.flow.update({ where: { id: draft.id }, data: { visibility: 'draft' } });

  const deleted = await compiledGuide(ws, 'Deleted guide');
  await prisma.flow.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });

  const uncompiledAssetId = await ws.upload();
  const uncompiledSession = ((await (await ws.createRun({ title: 'Uncompiled guide' })).json()) as {
    session_id: string;
  }).session_id;
  await ws.addStep(uncompiledSession, stepBody(uncompiledAssetId));

  const response = await listGuides(app, ws.workspaceSlug);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('public, max-age=30');

  const body = (await response.json()) as {
    guides: Array<{ slug: string; title: string; summary: string; updated_at: string; steps: number }>;
    total: number;
  };
  expect(body.total).toBe(2);
  expect(body.guides.map((guide) => guide.title)).toEqual(['Newer guide', 'Older guide']);
  expect(body.guides[0]!.slug).toBe(newer.slug!);
  expect(body.guides[0]!.steps).toBe(1);
  expect(body.guides[0]!.summary).toBe('Click Save');
});

test('limit is capped at 50 and non-numeric limit/offset fall back to defaults', async () => {
  const app = await newApp();
  const ws = await workspace(app);
  await compiledGuide(ws, 'Just one guide');

  const capped = await listGuides(app, ws.workspaceSlug, '?limit=999');
  expect(capped.status).toBe(200);

  const defaulted = await listGuides(app, ws.workspaceSlug, '?limit=abc&offset=xyz');
  expect(defaulted.status).toBe(200);
  const body = (await defaulted.json()) as { guides: unknown[] };
  expect(body.guides).toHaveLength(1);
});

test('summary falls back to the first step instruction cut at 160 chars', async () => {
  const app = await newApp();
  const ws = await workspace(app);
  const longInstruction = 'x'.repeat(200);
  await compiledGuide(ws, 'Long instruction guide', longInstruction);

  const response = await listGuides(app, ws.workspaceSlug);
  const body = (await response.json()) as { guides: Array<{ summary: string }> };
  expect(body.guides[0]!.summary).toBe(`${'x'.repeat(160)}…`);
});

test('two workspaces never see each others guides', async () => {
  const app = await newApp();
  const one = await workspace(app);
  const two = await workspace(app, OTHER_GITHUB_ACCOUNT);

  await compiledGuide(one, 'Workspace one guide');
  await compiledGuide(two, 'Workspace two guide');

  const oneList = (await (await listGuides(app, one.workspaceSlug)).json()) as { guides: Array<{ title: string }> };
  const twoList = (await (await listGuides(app, two.workspaceSlug)).json()) as { guides: Array<{ title: string }> };

  expect(oneList.guides.map((g) => g.title)).toEqual(['Workspace one guide']);
  expect(twoList.guides.map((g) => g.title)).toEqual(['Workspace two guide']);
});

test('unknown workspace slug is 404 not_found', async () => {
  const app = await newApp();
  const response = await listGuides(app, 'totally-unknown-workspace');
  expect(response.status).toBe(404);
  expect((await errorBody(response)).error.code).toBe('not_found');
});

test('a suspended workspace is 404, identical to an unknown one', async () => {
  const app = await newApp();
  const ws = await workspace(app);
  await prisma.organization.update({ where: { id: ws.organizationId }, data: { suspendedAt: new Date() } });

  const suspended = await listGuides(app, ws.workspaceSlug);
  const unknown = await listGuides(app, 'totally-unknown-workspace');

  expect(suspended.status).toBe(unknown.status);
  expect(await errorBody(suspended)).toEqual(await errorBody(unknown));
});

test('search finds a title word, a summary word and a step-instruction word', async () => {
  const app = await newApp();
  const ws = await workspace(app);

  const titleMatch = await compiledGuide(ws, 'WhatsApp template guide');
  const stepMatch = await compiledGuide(ws, 'Some other guide', 'Configure the invoice settings');
  const summaryMatch = await compiledGuide(ws, 'Another guide');
  await prisma.flow.update({ where: { id: summaryMatch.id }, data: { summary: 'Covers billing cycles' } });
  await prisma.$executeRaw`
    UPDATE "Flow" SET "search" =
      setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(summary, '')), 'B')
    WHERE id = ${summaryMatch.id}
  `;

  const byTitle = (await (await search(app, ws.workspaceSlug, 'whatsapp')).json()) as {
    results: Array<{ slug: string }>;
  };
  expect(byTitle.results.map((r) => r.slug)).toContain(titleMatch.slug!);

  const byStep = (await (await search(app, ws.workspaceSlug, 'invoice')).json()) as {
    results: Array<{ slug: string }>;
  };
  expect(byStep.results.map((r) => r.slug)).toContain(stepMatch.slug!);

  const bySummary = (await (await search(app, ws.workspaceSlug, 'billing')).json()) as {
    results: Array<{ slug: string }>;
  };
  expect(bySummary.results.map((r) => r.slug)).toContain(summaryMatch.slug!);
});

test('a title match ranks above a step-only match', async () => {
  const app = await newApp();
  const ws = await workspace(app);

  const titleMatch = await compiledGuide(ws, 'Template guide', 'Click the button');
  const stepOnly = await compiledGuide(ws, 'Unrelated guide', 'Fill in the template field');

  const response = await search(app, ws.workspaceSlug, 'template');
  const body = (await response.json()) as { results: Array<{ slug: string }> };

  const titleIndex = body.results.findIndex((r) => r.slug === titleMatch.slug!);
  const stepIndex = body.results.findIndex((r) => r.slug === stepOnly.slug!);
  expect(titleIndex).toBeGreaterThanOrEqual(0);
  expect(stepIndex).toBeGreaterThanOrEqual(0);
  expect(titleIndex).toBeLessThan(stepIndex);
});

test('a prefix query finds a longer word', async () => {
  const app = await newApp();
  const ws = await workspace(app);
  const guide = await compiledGuide(ws, 'A template guide');

  const response = await search(app, ws.workspaceSlug, 'temp');
  const body = (await response.json()) as { results: Array<{ slug: string }> };
  expect(body.results.map((r) => r.slug)).toContain(guide.slug!);
});

test('unlisted, draft, deleted and other-workspace flows never show up in search', async () => {
  const app = await newApp();
  const one = await workspace(app);
  const two = await workspace(app, OTHER_GITHUB_ACCOUNT);

  const unlisted = await compiledGuide(one, 'Unlisted template');
  await prisma.flow.update({ where: { id: unlisted.id }, data: { visibility: 'unlisted' } });

  const draft = await compiledGuide(one, 'Draft template');
  await prisma.flow.update({ where: { id: draft.id }, data: { visibility: 'draft' } });

  const deleted = await compiledGuide(one, 'Deleted template');
  await prisma.flow.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });

  await compiledGuide(two, 'Other workspace template');

  const response = await search(app, one.workspaceSlug, 'template');
  const body = (await response.json()) as { results: unknown[] };
  expect(body.results).toEqual([]);
});

test('empty query returns no results', async () => {
  const app = await newApp();
  const ws = await workspace(app);
  await compiledGuide(ws, 'Some guide');

  const response = await search(app, ws.workspaceSlug, '   ');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ results: [], counts: [] });
});

test('SQL-ish query characters never cause a server error', async () => {
  const app = await newApp();
  const ws = await workspace(app);
  await compiledGuide(ws, 'Some guide');

  const injection = await search(app, ws.workspaceSlug, `'; drop table "Flow";--`);
  expect(injection.status).toBe(200);

  const operators = await search(app, ws.workspaceSlug, 'a & b | !c');
  expect(operators.status).toBe(200);

  expect(await prisma.flow.count()).toBeGreaterThan(0);
});

test('guide JSON opens for an unlisted flow with noindex, matches the doc shape plus reader fields', async () => {
  const app = await newApp();
  const ws = await workspace(app);
  const guide = await compiledGuide(ws, 'Unlisted but reachable');
  await prisma.flow.update({ where: { id: guide.id }, data: { visibility: 'unlisted' } });

  const response = await getGuide(app, ws.workspaceSlug, guide.slug!);
  expect(response.status).toBe(200);
  expect(response.headers.get('x-robots-tag')).toBe('noindex');

  const body = (await response.json()) as {
    public_id: string;
    title: string;
    slug: string;
    summary: string;
    visibility: string;
    updated_at: string;
    steps: unknown[];
    prev: unknown;
    next: unknown;
  };
  expect(body.public_id).toBe(guide.publicId);
  expect(body.slug).toBe(guide.slug!);
  expect(body.visibility).toBe('unlisted');
  expect(body.steps).toHaveLength(1);
});

test('guide JSON exposes seo_title, seo_description and noindex', async () => {
  const app = await newApp();
  const ws = await workspace(app);
  const guide = await compiledGuide(ws, 'Guide with SEO fields');
  await prisma.flow.update({
    where: { id: guide.id },
    data: { seoTitle: 'Custom SEO Title', seoDescription: 'Custom SEO description', noindex: true },
  });

  const response = await getGuide(app, ws.workspaceSlug, guide.slug!);
  expect(response.status).toBe(200);
  // noindex is independent of visibility: a published guide with noindex still gets the header.
  expect(response.headers.get('x-robots-tag')).toBe('noindex');

  const body = (await response.json()) as {
    seo_title: string | null;
    seo_description: string | null;
    noindex: boolean;
  };
  expect(body.seo_title).toBe('Custom SEO Title');
  expect(body.seo_description).toBe('Custom SEO description');
  expect(body.noindex).toBe(true);
});

test('guide JSON has null seo_title/seo_description and noindex false by default', async () => {
  const app = await newApp();
  const ws = await workspace(app);
  const guide = await compiledGuide(ws, 'Plain guide');

  const body = (await (await getGuide(app, ws.workspaceSlug, guide.slug!)).json()) as {
    seo_title: string | null;
    seo_description: string | null;
    noindex: boolean;
  };
  expect(body.seo_title).toBeNull();
  expect(body.seo_description).toBeNull();
  expect(body.noindex).toBe(false);
});

test('draft, deleted, other-workspace and unknown guide slugs all get the identical 404 body', async () => {
  const app = await newApp();
  const one = await workspace(app);
  const two = await workspace(app, OTHER_GITHUB_ACCOUNT);

  const draft = await compiledGuide(one, 'Draft guide');
  await prisma.flow.update({ where: { id: draft.id }, data: { visibility: 'draft' } });

  const deleted = await compiledGuide(one, 'Deleted guide');
  await prisma.flow.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });

  const otherGuide = await compiledGuide(two, 'Other workspace guide');

  const unknownBody = await errorBody(await getGuide(app, one.workspaceSlug, 'totally-unknown-slug'));
  const draftBody = await errorBody(await getGuide(app, one.workspaceSlug, draft.slug!));
  const deletedBody = await errorBody(await getGuide(app, one.workspaceSlug, deleted.slug!));
  const otherWorkspaceBody = await errorBody(await getGuide(app, one.workspaceSlug, otherGuide.slug!));

  expect(draftBody).toEqual(unknownBody);
  expect(deletedBody).toEqual(unknownBody);
  expect(otherWorkspaceBody).toEqual(unknownBody);
});

test('a suspended workspace 404 for a guide matches an unknown workspace', async () => {
  const app = await newApp();
  const ws = await workspace(app);
  const guide = await compiledGuide(ws, 'Some guide');
  await prisma.organization.update({ where: { id: ws.organizationId }, data: { suspendedAt: new Date() } });

  const suspendedBody = await errorBody(await getGuide(app, ws.workspaceSlug, guide.slug!));
  const unknownBody = await errorBody(await getGuide(app, 'totally-unknown-workspace', guide.slug!));

  expect(suspendedBody).toEqual(unknownBody);
});

test('canonical URL is built from the org slug and flow slug when TENANT_BASE_DOMAIN is set', async () => {
  process.env.TENANT_BASE_DOMAIN = 'example.test';
  try {
    const app = await newApp();
    const ws = await workspace(app);
    const guide = await compiledGuide(ws, 'Some guide');

    const response = await getCanonical(app, guide.publicId);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=30');
    const body = (await response.json()) as { url: string };
    expect(body.url).toBe(`https://${ws.workspaceSlug}.example.test/g/${guide.slug}`);
  } finally {
    delete process.env.TENANT_BASE_DOMAIN;
  }
});

test('canonical is 404 when TENANT_BASE_DOMAIN is unset', async () => {
  delete process.env.TENANT_BASE_DOMAIN;
  const app = await newApp();
  const ws = await workspace(app);
  const guide = await compiledGuide(ws, 'Some guide');

  const response = await getCanonical(app, guide.publicId);
  expect(response.status).toBe(404);
});

test('canonical is 404 for unlisted, draft, deleted, unslugged or suspended-workspace flows', async () => {
  process.env.TENANT_BASE_DOMAIN = 'example.test';
  try {
    const app = await newApp();
    const ws = await workspace(app);

    const unlisted = await compiledGuide(ws, 'Unlisted guide');
    await prisma.flow.update({ where: { id: unlisted.id }, data: { visibility: 'unlisted' } });

    const draft = await compiledGuide(ws, 'Draft guide');
    await prisma.flow.update({ where: { id: draft.id }, data: { visibility: 'draft' } });

    const deleted = await compiledGuide(ws, 'Deleted guide');
    await prisma.flow.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });

    const suspendedGuide = await compiledGuide(ws, 'Guide for suspended workspace');
    await prisma.organization.update({ where: { id: ws.organizationId }, data: { suspendedAt: new Date() } });

    const unlistedResponse = await getCanonical(app, unlisted.publicId);
    const draftResponse = await getCanonical(app, draft.publicId);
    const deletedResponse = await getCanonical(app, deleted.publicId);
    const suspendedResponse = await getCanonical(app, suspendedGuide.publicId);
    const unknownResponse = await getCanonical(app, 'totally-unknown-public-id');

    expect(unlistedResponse.status).toBe(404);
    expect(draftResponse.status).toBe(404);
    expect(deletedResponse.status).toBe(404);
    expect(suspendedResponse.status).toBe(404);
    expect(unknownResponse.status).toBe(404);
    expect(await errorBody(unlistedResponse)).toEqual(await errorBody(unknownResponse));
  } finally {
    delete process.env.TENANT_BASE_DOMAIN;
  }
});

test('prev/next neighbours are correct and null at the ends', async () => {
  const app = await newApp();
  const ws = await workspace(app);

  const oldest = await compiledGuide(ws, 'Oldest guide');
  await new Promise((resolve) => setTimeout(resolve, 5));
  const middle = await compiledGuide(ws, 'Middle guide');
  await new Promise((resolve) => setTimeout(resolve, 5));
  const newest = await compiledGuide(ws, 'Newest guide');

  const middleBody = (await (await getGuide(app, ws.workspaceSlug, middle.slug!)).json()) as {
    prev: { slug: string } | null;
    next: { slug: string } | null;
  };
  expect(middleBody.prev?.slug).toBe(newest.slug!);
  expect(middleBody.next?.slug).toBe(oldest.slug!);

  const newestBody = (await (await getGuide(app, ws.workspaceSlug, newest.slug!)).json()) as {
    prev: unknown;
    next: { slug: string } | null;
  };
  expect(newestBody.prev).toBeNull();
  expect(newestBody.next?.slug).toBe(middle.slug!);

  const oldestBody = (await (await getGuide(app, ws.workspaceSlug, oldest.slug!)).json()) as {
    prev: { slug: string } | null;
    next: unknown;
  };
  expect(oldestBody.prev?.slug).toBe(middle.slug!);
  expect(oldestBody.next).toBeNull();
});

test('categories route lists only active categories with listed-guide counts, omits suggested and empty', async () => {
  const app = await newApp();
  const ws = await workspace(app);

  const guide1 = await compiledGuide(ws, 'Guide 1');
  const guide2 = await compiledGuide(ws, 'Guide 2');
  const guide3 = await compiledGuide(ws, 'Guide 3');

  const activeCategory = await prisma.category.create({
    data: { organizationId: ws.organizationId, slug: 'active-cat', name: 'Active Category', position: 1, status: 'active' },
  });
  const suggestedCategory = await prisma.category.create({
    data: { organizationId: ws.organizationId, slug: 'suggested-cat', name: 'Suggested Category', position: 2, status: 'suggested' },
  });
  const emptyCategory = await prisma.category.create({
    data: { organizationId: ws.organizationId, slug: 'empty-cat', name: 'Empty Category', position: 0, status: 'active', description: 'Empty' },
  });

  await prisma.flow.update({ where: { id: guide1.id }, data: { categoryId: activeCategory.id } });
  await prisma.flow.update({ where: { id: guide2.id }, data: { categoryId: activeCategory.id } });
  await prisma.flow.update({ where: { id: guide3.id }, data: { categoryId: suggestedCategory.id } });

  const response = await getCategories(app, ws.workspaceSlug);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('public, max-age=30');

  const body = (await response.json()) as {
    categories: Array<{ slug: string; name: string; description: string; guides: number; sample_guides?: Array<{ slug: string; title: string }> }>;
  };
  expect(body.categories).toHaveLength(1);
  expect(body.categories[0]).toMatchObject({
    slug: activeCategory.slug,
    name: activeCategory.name,
    guides: 2,
  });
  expect(body.categories[0]?.sample_guides).toHaveLength(2);
});

test('guides list with category filter returns only that category\'s guides', async () => {
  const app = await newApp();
  const ws = await workspace(app);

  const guide1 = await compiledGuide(ws, 'Guides 1');
  const guide2 = await compiledGuide(ws, 'Guide 2');
  const uncategorized = await compiledGuide(ws, 'Uncategorized guide');

  const category = await prisma.category.create({
    data: { organizationId: ws.organizationId, slug: 'test-cat', name: 'Test Category', status: 'active' },
  });

  await prisma.flow.update({ where: { id: guide1.id }, data: { categoryId: category.id } });
  await prisma.flow.update({ where: { id: guide2.id }, data: { categoryId: category.id } });

  const response = await listGuides(app, ws.workspaceSlug, `?category=${encodeURIComponent(category.slug)}`);
  expect(response.status).toBe(200);

  const body = (await response.json()) as { guides: Array<{ title: string }> ; total: number };
  expect(body.total).toBe(2);
  expect(body.guides.map((g) => g.title)).toEqual(expect.arrayContaining(['Guides 1', 'Guide 2']));
  expect(body.guides.map((g) => g.title)).not.toContain('Uncategorized guide');
});

test('guides list with unknown or suggested category slug returns empty', async () => {
  const app = await newApp();
  const ws = await workspace(app);
  await compiledGuide(ws, 'Some guide');

  const suggestedCategory = await prisma.category.create({
    data: { organizationId: ws.organizationId, slug: 'suggested-cat', name: 'Suggested', status: 'suggested' },
  });

  const unknownResponse = await listGuides(app, ws.workspaceSlug, '?category=totally-unknown');
  expect(unknownResponse.status).toBe(200);
  const unknownBody = (await unknownResponse.json()) as { guides: unknown[]; total: number };
  expect(unknownBody).toEqual({ guides: [], total: 0 });

  const suggestedResponse = await listGuides(app, ws.workspaceSlug, `?category=${suggestedCategory.slug}`);
  expect(suggestedResponse.status).toBe(200);
  const suggestedBody = (await suggestedResponse.json()) as { guides: unknown[]; total: number };
  expect(suggestedBody).toEqual({ guides: [], total: 0 });
});

test('guide items in list carry category info, null for uncategorized or non-active', async () => {
  const app = await newApp();
  const ws = await workspace(app);

  const categorized = await compiledGuide(ws, 'Categorized guide');
  const uncategorized = await compiledGuide(ws, 'Uncategorized guide');
  const suggestedCategoryGuide = await compiledGuide(ws, 'Suggested category guide');

  const activeCategory = await prisma.category.create({
    data: { organizationId: ws.organizationId, slug: 'active-cat', name: 'Active', status: 'active' },
  });
  const suggestedCategory = await prisma.category.create({
    data: { organizationId: ws.organizationId, slug: 'suggested-cat', name: 'Suggested', status: 'suggested' },
  });

  await prisma.flow.update({ where: { id: categorized.id }, data: { categoryId: activeCategory.id } });
  await prisma.flow.update({ where: { id: suggestedCategoryGuide.id }, data: { categoryId: suggestedCategory.id } });

  const response = await listGuides(app, ws.workspaceSlug);
  const body = (await response.json()) as {
    guides: Array<{ title: string; category: { slug: string; name: string } | null }>;
  };

  const categorizedItem = body.guides.find((g) => g.title === 'Categorized guide');
  expect(categorizedItem?.category).toEqual({ slug: activeCategory.slug, name: activeCategory.name });

  const uncategorizedItem = body.guides.find((g) => g.title === 'Uncategorized guide');
  expect(uncategorizedItem?.category).toBeNull();

  const suggestedItem = body.guides.find((g) => g.title === 'Suggested category guide');
  expect(suggestedItem?.category).toBeNull();
});

test('guide detail JSON carries category info, null for uncategorized or non-active', async () => {
  const app = await newApp();
  const ws = await workspace(app);

  const categorized = await compiledGuide(ws, 'Categorized guide');
  const suggestedCategoryGuide = await compiledGuide(ws, 'Suggested category guide');

  const activeCategory = await prisma.category.create({
    data: { organizationId: ws.organizationId, slug: 'active-cat', name: 'Active', status: 'active' },
  });
  const suggestedCategory = await prisma.category.create({
    data: { organizationId: ws.organizationId, slug: 'suggested-cat', name: 'Suggested', status: 'suggested' },
  });

  await prisma.flow.update({ where: { id: categorized.id }, data: { categoryId: activeCategory.id } });
  await prisma.flow.update({ where: { id: suggestedCategoryGuide.id }, data: { categoryId: suggestedCategory.id } });

  const categorizedResponse = await getGuide(app, ws.workspaceSlug, categorized.slug!);
  const categorizedBody = (await categorizedResponse.json()) as { category: { slug: string; name: string } | null };
  expect(categorizedBody.category).toEqual({ slug: activeCategory.slug, name: activeCategory.name });

  const suggestedResponse = await getGuide(app, ws.workspaceSlug, suggestedCategoryGuide.slug!);
  const suggestedBody = (await suggestedResponse.json()) as { category: { slug: string; name: string } | null };
  expect(suggestedBody.category).toBeNull();
});

test('search with category filter returns only that category\'s matches', async () => {
  const app = await newApp();
  const ws = await workspace(app);

  const guide1 = await compiledGuide(ws, 'Template guide one');
  const guide2 = await compiledGuide(ws, 'Template guide two');
  const guide3 = await compiledGuide(ws, 'Template guide three');

  const category1 = await prisma.category.create({
    data: { organizationId: ws.organizationId, slug: 'cat1', name: 'Category 1', status: 'active' },
  });
  const category2 = await prisma.category.create({
    data: { organizationId: ws.organizationId, slug: 'cat2', name: 'Category 2', status: 'active' },
  });

  await prisma.flow.update({ where: { id: guide1.id }, data: { categoryId: category1.id } });
  await prisma.flow.update({ where: { id: guide2.id }, data: { categoryId: category2.id } });
  await prisma.flow.update({ where: { id: guide3.id }, data: { categoryId: category1.id } });

  const allResults = (await (await search(app, ws.workspaceSlug, 'template')).json()) as {
    results: Array<{ slug: string }>;
  };
  expect(allResults.results).toHaveLength(3);

  const filtered = (await (await search(app, ws.workspaceSlug, 'template', category1.slug)).json()) as {
    results: Array<{ slug: string }>;
  };
  expect(filtered.results).toHaveLength(2);
  expect(filtered.results.map((r) => r.slug)).toContain(guide1.slug!);
  expect(filtered.results.map((r) => r.slug)).toContain(guide3.slug!);
  expect(filtered.results.map((r) => r.slug)).not.toContain(guide2.slug!);
});

test('search returns counts for all active categories matching the query, regardless of filter', async () => {
  const app = await newApp();
  const ws = await workspace(app);

  const guide1 = await compiledGuide(ws, 'Template guide one');
  const guide2 = await compiledGuide(ws, 'Template guide two');

  const category1 = await prisma.category.create({
    data: { organizationId: ws.organizationId, slug: 'cat1', name: 'Category 1', status: 'active', position: 1 },
  });
  const category2 = await prisma.category.create({
    data: { organizationId: ws.organizationId, slug: 'cat2', name: 'Category 2', status: 'active', position: 2 },
  });

  await prisma.flow.update({ where: { id: guide1.id }, data: { categoryId: category1.id } });
  await prisma.flow.update({ where: { id: guide2.id }, data: { categoryId: category2.id } });

  const response = (await (await search(app, ws.workspaceSlug, 'template')).json()) as {
    results: Array<{ slug: string }>;
    counts: Array<{ slug: string; name: string; count: number }>;
  };

  expect(response.counts).toHaveLength(2);
  expect(response.counts[0]).toMatchObject({ slug: category1.slug, name: category1.name, count: 1 });
  expect(response.counts[1]).toMatchObject({ slug: category2.slug, name: category2.name, count: 1 });
});

test('search results carry category info', async () => {
  const app = await newApp();
  const ws = await workspace(app);

  const categorized = await compiledGuide(ws, 'Template categorized');
  const uncategorized = await compiledGuide(ws, 'Template uncategorized');
  const suggestedCat = await compiledGuide(ws, 'Template suggested');

  const activeCategory = await prisma.category.create({
    data: { organizationId: ws.organizationId, slug: 'active-cat', name: 'Active', status: 'active' },
  });
  const suggestedCategory = await prisma.category.create({
    data: { organizationId: ws.organizationId, slug: 'suggested-cat', name: 'Suggested', status: 'suggested' },
  });

  await prisma.flow.update({ where: { id: categorized.id }, data: { categoryId: activeCategory.id } });
  await prisma.flow.update({ where: { id: suggestedCat.id }, data: { categoryId: suggestedCategory.id } });

  const response = (await (await search(app, ws.workspaceSlug, 'template')).json()) as {
    results: Array<{ title: string; category: { slug: string; name: string } | null; steps: number; snippet: string }>;
  };

  const categorizedItem = response.results.find((r) => r.title === 'Template categorized');
  expect(categorizedItem?.category).toEqual({ slug: activeCategory.slug, name: activeCategory.name });
  expect(categorizedItem?.steps).toBeGreaterThanOrEqual(1);
  expect(categorizedItem?.snippet).not.toContain('**');
  expect(categorizedItem?.snippet).not.toContain('`');

  const uncategorizedItem = response.results.find((r) => r.title === 'Template uncategorized');
  expect(uncategorizedItem?.category).toBeNull();

  const suggestedItem = response.results.find((r) => r.title === 'Template suggested');
  expect(suggestedItem?.category).toBeNull();
});

test('guide in suggested category is not included in category counts', async () => {
  const app = await newApp();
  const ws = await workspace(app);

  const guide = await compiledGuide(ws, 'Template guide');

  const suggestedCategory = await prisma.category.create({
    data: { organizationId: ws.organizationId, slug: 'suggested-cat', name: 'Suggested', status: 'suggested' },
  });

  await prisma.flow.update({ where: { id: guide.id }, data: { categoryId: suggestedCategory.id } });

  const response = (await (await search(app, ws.workspaceSlug, 'template')).json()) as { counts: unknown[] };
  expect(response.counts).toEqual([]);
});

test('unlisted and draft guides never add to category counts', async () => {
  const app = await newApp();
  const ws = await workspace(app);

  const published = await compiledGuide(ws, 'Template published');
  const unlisted = await compiledGuide(ws, 'Template unlisted');
  const draft = await compiledGuide(ws, 'Template draft');

  const category = await prisma.category.create({
    data: { organizationId: ws.organizationId, slug: 'test-cat', name: 'Test', status: 'active' },
  });

  await prisma.flow.update({ where: { id: published.id }, data: { categoryId: category.id } });
  await prisma.flow.update({ where: { id: unlisted.id }, data: { categoryId: category.id, visibility: 'unlisted' } });
  await prisma.flow.update({ where: { id: draft.id }, data: { categoryId: category.id, visibility: 'draft' } });

  const response = (await (await search(app, ws.workspaceSlug, 'template')).json()) as {
    counts: Array<{ count: number }>;
  };

  expect(response.counts).toHaveLength(1);
  expect(response.counts[0]?.count).toBe(1);
});

test('hidden steps do not appear on public guide reader route and do not count in step numbering or step counts', async () => {
  const app = await newApp();
  const ws = await workspace(app);

  const guide = await compiledGuide(ws, 'Guide with hidden steps');
  await prisma.step.create({
    data: {
      runId: guide.latestRunId!,
      order: 2,
      action: 'click',
      instruction: 'Step 2 instruction secret hidden',
      title: 'Hidden Step 2',
      hidden: true,
    },
  });
  await prisma.step.create({
    data: {
      runId: guide.latestRunId!,
      order: 3,
      action: 'click',
      instruction: 'Step 3 visible instruction',
      title: 'Visible Step 3',
      hidden: false,
    },
  });

  // 1. Guides list reports 2 steps (omits hidden step)
  const listRes = await listGuides(app, ws.workspaceSlug);
  const listBody = (await listRes.json()) as { guides: Array<{ slug: string; steps: number }> };
  const guideItem = listBody.guides.find((g) => g.slug === guide.slug);
  expect(guideItem?.steps).toBe(2);

  // 2. Guide detail on public site returns only the 2 visible steps, renumbered 1 and 2
  const guideRes = await getGuide(app, ws.workspaceSlug, guide.slug!);
  expect(guideRes.status).toBe(200);
  const guideBody = (await guideRes.json()) as {
    steps: Array<{ order: number; title?: string; instruction: string }>;
  };
  expect(guideBody.steps).toHaveLength(2);
  expect(guideBody.steps[0].order).toBe(1);
  expect(guideBody.steps[1].order).toBe(2);
  expect(guideBody.steps[1].title).toBe('Visible Step 3');

  // 3. If step 1 is also hidden, fallback summary uses the next visible step
  await prisma.step.updateMany({
    where: { runId: guide.latestRunId!, order: 1 },
    data: { hidden: true },
  });
  await prisma.flow.update({
    where: { id: guide.id },
    data: { summary: null },
  });

  const listRes2 = await listGuides(app, ws.workspaceSlug);
  const listBody2 = (await listRes2.json()) as { guides: Array<{ slug: string; steps: number; summary: string }> };
  const guideItem2 = listBody2.guides.find((g) => g.slug === guide.slug);
  expect(guideItem2?.steps).toBe(1);
  expect(guideItem2?.summary).toContain('Step 3 visible instruction');
});
