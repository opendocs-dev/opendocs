import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { BASE_URL, cleanDatabase, realFetch, signIn, type App } from '../../test/helpers';
import { tinyPng } from '../../test/images';
import { getPrisma } from '../db';
import { createApp } from '../index';
import { LocalDiskProvider } from '../storage/local';

const prisma = getPrisma();

type Workspace = {
  app: App;
  cookie: string;
  upload: () => Promise<string>;
  createRun: (body?: unknown) => Promise<Response>;
  addStep: (sessionId: string, body: unknown) => Promise<Response>;
  compile: (sessionId: string, body?: unknown) => Promise<Response>;
};

const newApp = async (): Promise<App> => {
  const root = await mkdtemp(join(tmpdir(), 'od-docs-'));
  return createApp(async () => {}, {
    provider: new LocalDiskProvider(root),
    accounts: ['local'],
  });
};

const workspace = async (app: App): Promise<Workspace> => {
  const cookie = await signIn(app);
  const post = (path: string, body: unknown) =>
    app.handle(
      new Request(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      }),
    );

  return {
    app,
    cookie,
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

const getDoc = (app: App, publicId: string) =>
  app.handle(new Request(`${BASE_URL}/api/v1/docs/${publicId}`));

const getMarkdown = (app: App, publicId: string) =>
  app.handle(new Request(`${BASE_URL}/api/v1/docs/${publicId}/markdown`));

beforeEach(async () => {
  await cleanDatabase();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  await cleanDatabase();
});

test('returns ordered steps with image size', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({ title: 'Reset a password' })).json()) as {
    session_id: string;
  }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId, { instruction: 'Step one' }));
  await ws.addStep(sessionId, stepBody(assetId, { instruction: 'Step two', selector: undefined }));
  await ws.compile(sessionId);

  const flow = await prisma.flow.findFirstOrThrow();
  const asset = await prisma.asset.findUniqueOrThrow({ where: { publicId: assetId } });

  const response = await getDoc(ws.app, flow.publicId);

  expect(response.status).toBe(200);
  expect(response.headers.get('x-robots-tag')).toBe('noindex');
  const body = (await response.json()) as {
    public_id: string;
    title: string;
    steps: Array<{
      order: number;
      instruction: string;
      selector?: string;
      image: { url: string | null; expired: boolean; width?: number; height?: number };
    }>;
  };

  expect(body.public_id).toBe(flow.publicId);
  expect(body.title).toBe('Reset a password');
  expect(body.steps).toHaveLength(2);
  expect(body.steps[0]!.order).toBe(1);
  expect(body.steps[0]!.instruction).toBe('Step one');
  expect(body.steps[0]!.selector).toBe('#save');
  expect(body.steps[0]!.image).toEqual({
    url: `${process.env.ASSET_BASE_URL}/i/${assetId}`,
    expired: false,
    width: asset.width,
    height: asset.height,
  });
  expect(body.steps[1]!.order).toBe(2);
  expect(body.steps[1]!.instruction).toBe('Step two');
  expect(body.steps[1]!.selector).toBeUndefined();
});

test('expired image has null url', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId));
  await ws.compile(sessionId);

  await prisma.asset.update({
    where: { publicId: assetId },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });

  const flow = await prisma.flow.findFirstOrThrow();
  const response = await getDoc(ws.app, flow.publicId);

  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    steps: Array<{ image: { url: string | null; expired: boolean } }>;
  };
  expect(body.steps[0]!.image).toEqual({ url: null, expired: true });
});

test('unknown or uncompiled flow is 404', async () => {
  const app = await newApp();

  const unknown = await getDoc(app, '0123456789ABCDEF');
  expect(unknown.status).toBe(404);
  expect(await errorCode(unknown)).toBe('not_found');

  const ws = await workspace(app);
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId));
  const flow = await prisma.flow.findFirstOrThrow();

  const uncompiled = await getDoc(app, flow.publicId);
  expect(uncompiled.status).toBe(404);
  expect(await errorCode(uncompiled)).toBe('not_found');
});

test('deleted flow is 404', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId));
  await ws.compile(sessionId);

  const flow = await prisma.flow.findFirstOrThrow();
  await prisma.flow.update({ where: { id: flow.id }, data: { deletedAt: new Date() } });

  const response = await getDoc(ws.app, flow.publicId);

  expect(response.status).toBe(404);
  expect(await errorCode(response)).toBe('not_found');
});

test('returns markdown with ordered steps', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({ title: 'Reset a password' })).json()) as {
    session_id: string;
  }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId, { instruction: 'Step one' }));
  await ws.addStep(sessionId, stepBody(assetId, { instruction: 'Step two' }));
  await ws.compile(sessionId);

  const flow = await prisma.flow.findFirstOrThrow();
  const response = await getMarkdown(ws.app, flow.publicId);

  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
  expect(response.headers.get('x-robots-tag')).toBe('noindex');

  const body = await response.text();
  const imageUrl = `${process.env.ASSET_BASE_URL}/i/${assetId}`;
  expect(body).toBe(
    [
      '# Reset a password',
      '',
      '## Step 1',
      '',
      'Step one',
      '',
      `![Step 1](${imageUrl})`,
      '',
      '## Step 2',
      '',
      'Step two',
      '',
      `![Step 2](${imageUrl})`,
      '',
    ].join('\n'),
  );
});

test('doc JSON returns title, alt, viewport, iframes', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(
    sessionId,
    stepBody(assetId, {
      title: 'Save the form',
      alt: 'Screenshot of the save button',
      redaction: {
        mode: 'strict',
        report: { count: 1, script_version: '1.0.0', viewport: { w: 1280, h: 800, dpr: 2 }, iframes: 1 },
      },
    }),
  );
  await ws.compile(sessionId);

  const flow = await prisma.flow.findFirstOrThrow();
  const response = await getDoc(ws.app, flow.publicId);

  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    steps: Array<{
      title?: string;
      alt?: string;
      viewport?: { w: number; h: number; dpr: number };
      iframes?: number;
    }>;
  };
  expect(body.steps[0]!.title).toBe('Save the form');
  expect(body.steps[0]!.alt).toBe('Screenshot of the save button');
  expect(body.steps[0]!.viewport).toEqual({ w: 1280, h: 800, dpr: 2 });
  expect(body.steps[0]!.iframes).toBe(1);
});

test('md export uses title and alt', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(
    sessionId,
    stepBody(assetId, { title: 'Save the form', alt: 'Screenshot of the save button' }),
  );
  await ws.compile(sessionId);

  const flow = await prisma.flow.findFirstOrThrow();
  const body = await (await getMarkdown(ws.app, flow.publicId)).text();
  const imageUrl = `${process.env.ASSET_BASE_URL}/i/${assetId}`;

  expect(body).toContain('## Step 1: Save the form');
  expect(body).toContain(`![Screenshot of the save button](${imageUrl})`);
});

test('alt with brackets and newline is escaped', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId, { alt: 'Click [Save]\n(now)' }));
  await ws.compile(sessionId);

  const flow = await prisma.flow.findFirstOrThrow();
  const body = await (await getMarkdown(ws.app, flow.publicId)).text();
  const imageUrl = `${process.env.ASSET_BASE_URL}/i/${assetId}`;

  expect(body).toContain(`![Click \\[Save\\] \\(now\\)](${imageUrl})`);
});

test('alt ending in a backslash cannot escape the closing bracket', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId, { alt: 'Open C:\\' }));
  await ws.compile(sessionId);

  const flow = await prisma.flow.findFirstOrThrow();
  const body = await (await getMarkdown(ws.app, flow.publicId)).text();
  const imageUrl = `${process.env.ASSET_BASE_URL}/i/${assetId}`;

  expect(body).toContain(`![Open C:\\\\](${imageUrl})`);
});

test('replaces an expired image with a note', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({ title: 'Reset a password' })).json()) as {
    session_id: string;
  }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId));
  await ws.compile(sessionId);

  await prisma.asset.update({
    where: { publicId: assetId },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });

  const flow = await prisma.flow.findFirstOrThrow();
  const response = await getMarkdown(ws.app, flow.publicId);

  expect(response.status).toBe(200);
  const body = await response.text();
  expect(body).toContain('_Image no longer available._');
  expect(body).not.toContain('![Step 1]');
});

test('404 for an unknown publicId', async () => {
  const app = await newApp();

  const response = await getMarkdown(app, '0123456789ABCDEF');

  expect(response.status).toBe(404);
  expect(await errorCode(response)).toBe('not_found');
});

test('escapes headings in instruction text', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({ title: '# Not a heading' })).json()) as {
    session_id: string;
  }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(
    sessionId,
    stepBody(assetId, { instruction: '# Click here\nthen wait' }),
  );
  await ws.compile(sessionId);

  const flow = await prisma.flow.findFirstOrThrow();
  const response = await getMarkdown(ws.app, flow.publicId);

  expect(response.status).toBe(200);
  const body = await response.text();
  const lines = body.split('\n');

  expect(lines[0]).toBe('# \\# Not a heading');
  const stepLine = lines.findIndex((line) => line === '## Step 1');
  expect(lines[stepLine + 2]).toBe('\\# Click here then wait');
});

test('neutralizes links, images, html and fences in instruction text', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(
    sessionId,
    stepBody(assetId, {
      instruction: 'See ![x](javascript:alert(1)) and [y](https://evil.test) <img src=x onerror=alert(1)> ```',
    }),
  );
  await ws.compile(sessionId);

  const flow = await prisma.flow.findFirstOrThrow();
  const body = await (await getMarkdown(ws.app, flow.publicId)).text();
  const line = body.split('\n').find((l) => l.startsWith('See'))!;

  expect(line).toBe(
    'See \\!\\[x\\](javascript:alert(1)) and \\[y\\](https://evil.test) \\<img src=x onerror=alert(1)\\> \\`\\`\\`',
  );
});

test('prose punctuation stays readable', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  const instruction = 'Open github.com/oven-sh/bun. Pick bun-linux-x64.zip (v1.4.2) + docs.';
  await ws.addStep(sessionId, stepBody(assetId, { instruction }));
  await ws.compile(sessionId);

  const flow = await prisma.flow.findFirstOrThrow();
  const body = await (await getMarkdown(ws.app, flow.publicId)).text();
  const lines = body.split('\n');
  const stepLine = lines.findIndex((line) => line === '## Step 1');

  expect(lines[stepLine + 2]).toBe(instruction);
});

test('leading list/heading markers are escaped', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId, { instruction: '- a' }));
  await ws.addStep(sessionId, stepBody(assetId, { instruction: '+ a' }));
  await ws.addStep(sessionId, stepBody(assetId, { instruction: '1. a' }));
  await ws.addStep(sessionId, stepBody(assetId, { instruction: '# a' }));
  await ws.compile(sessionId);

  const flow = await prisma.flow.findFirstOrThrow();
  const body = await (await getMarkdown(ws.app, flow.publicId)).text();
  const lines = body.split('\n');

  const instructionFor = (order: number) => {
    const stepLine = lines.findIndex((line) => line === `## Step ${order}`);
    return lines[stepLine + 2];
  };

  expect(instructionFor(1)).toBe('\\- a');
  expect(instructionFor(2)).toBe('\\+ a');
  expect(instructionFor(3)).toBe('1\\. a');
  expect(instructionFor(4)).toBe('\\# a');
});

test('renders a well-formed bold span as real markdown bold', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId, { instruction: 'Click **Add to cart** now' }));
  await ws.compile(sessionId);

  const flow = await prisma.flow.findFirstOrThrow();
  const body = await (await getMarkdown(ws.app, flow.publicId)).text();
  const lines = body.split('\n');
  const stepLine = lines.findIndex((line) => line === '## Step 1');

  expect(lines[stepLine + 2]).toBe('Click **Add to cart** now');
});

test('escapes markup inside a bold span while keeping the bold delimiters', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId, { instruction: '**[x](y)**' }));
  await ws.compile(sessionId);

  const flow = await prisma.flow.findFirstOrThrow();
  const body = await (await getMarkdown(ws.app, flow.publicId)).text();
  const lines = body.split('\n');
  const stepLine = lines.findIndex((line) => line === '## Step 1');

  expect(lines[stepLine + 2]).toBe('**\\[x\\](y)**');
});

test('an unbalanced bold marker stays escaped', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId, { instruction: '**Click here' }));
  await ws.compile(sessionId);

  const flow = await prisma.flow.findFirstOrThrow();
  const body = await (await getMarkdown(ws.app, flow.publicId)).text();
  const lines = body.split('\n');
  const stepLine = lines.findIndex((line) => line === '## Step 1');

  expect(lines[stepLine + 2]).toBe('\\*\\*Click here');
});

test('a code span passes through unchanged', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId, { instruction: 'save `Bun_(software).pdf`' }));
  await ws.compile(sessionId);

  const flow = await prisma.flow.findFirstOrThrow();
  const body = await (await getMarkdown(ws.app, flow.publicId)).text();
  const lines = body.split('\n');
  const stepLine = lines.findIndex((line) => line === '## Step 1');

  expect(lines[stepLine + 2]).toBe('save `Bun_(software).pdf`');
});

test('a code span containing markup stays unescaped inside the backticks', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId, { instruction: 'run `[x](y)` and `<b>` now' }));
  await ws.compile(sessionId);

  const flow = await prisma.flow.findFirstOrThrow();
  const body = await (await getMarkdown(ws.app, flow.publicId)).text();
  const lines = body.split('\n');
  const stepLine = lines.findIndex((line) => line === '## Step 1');

  expect(lines[stepLine + 2]).toBe('run `[x](y)` and `<b>` now');
});

test('an unbalanced backtick stays escaped', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId, { instruction: 'a `b' }));
  await ws.compile(sessionId);

  const flow = await prisma.flow.findFirstOrThrow();
  const body = await (await getMarkdown(ws.app, flow.publicId)).text();
  const lines = body.split('\n');
  const stepLine = lines.findIndex((line) => line === '## Step 1');

  expect(lines[stepLine + 2]).toBe('a \\`b');
});

test('leading markers prefixed by 1-3 spaces are escaped', async () => {
  const ws = await workspace(await newApp());
  const sessionId = ((await (await ws.createRun({})).json()) as { session_id: string }).session_id;
  const assetId = await ws.upload();
  await ws.addStep(sessionId, stepBody(assetId, { instruction: ' - a' }));
  await ws.addStep(sessionId, stepBody(assetId, { instruction: '   # a' }));
  await ws.addStep(sessionId, stepBody(assetId, { instruction: '  1. a' }));
  await ws.compile(sessionId);

  const flow = await prisma.flow.findFirstOrThrow();
  const body = await (await getMarkdown(ws.app, flow.publicId)).text();
  const lines = body.split('\n');

  const instructionFor = (order: number) => {
    const stepLine = lines.findIndex((line) => line === `## Step ${order}`);
    return lines[stepLine + 2];
  };

  expect(instructionFor(1)).toBe(' \\- a');
  expect(instructionFor(2)).toBe('   \\# a');
  expect(instructionFor(3)).toBe('  1\\. a');
});
