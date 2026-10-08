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

type UploadResponse = { id: string };
type CreateRunResponse = { session_id: string };

type StepPayload = {
  id: string;
  order: number;
  action: string;
  instruction: string;
  title: string | null;
  alt: string | null;
  page_url: string | null;
  selector: string | null;
  box: { x: number; y: number; w: number; h: number } | null;
  image: { url: string | null; width: number | null; height: number | null };
  hidden: boolean;
};

type StepsListResponse = { steps: StepPayload[] };
type PatchStepResponse = { step: StepPayload };
type DeleteStepResponse = { ok: boolean; remaining: number };
type PublicDocStep = {
  order: number;
  title?: string;
  instruction: string;
  alt?: string;
  box?: { x: number; y: number; w: number; h: number };
};
type PublicDocResponse = { steps: PublicDocStep[] };

type Workspace = {
  app: App;
  cookie: string;
  organizationId: string;
  upload: () => Promise<string>;
  createRun: (body?: unknown) => Promise<Response>;
  addStep: (sessionId: string, body: unknown) => Promise<Response>;
  compile: (sessionId: string, body?: unknown) => Promise<Response>;
  getSteps: (publicId: string) => Promise<Response>;
  patchStep: (publicId: string, stepId: string, body: unknown) => Promise<Response>;
  reorderSteps: (publicId: string, stepIds: string[]) => Promise<Response>;
  deleteStep: (publicId: string, stepId: string) => Promise<Response>;
  getPublicDoc: (publicId: string) => Promise<Response>;
};

const newApp = async (): Promise<App> => {
  const root = await mkdtemp(join(tmpdir(), 'od-steps-admin-'));
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

  const patch = (path: string, body: unknown) =>
    app.handle(
      new Request(`${BASE_URL}${path}`, {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      }),
    );

  const del = (path: string) =>
    app.handle(
      new Request(`${BASE_URL}${path}`, {
        method: 'DELETE',
        headers: { cookie },
      }),
    );

  const get = (path: string) =>
    app.handle(
      new Request(`${BASE_URL}${path}`, {
        headers: { cookie },
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
      const data: UploadResponse = await response.json();
      return data.id;
    },
    createRun: (body) => post('/api/v1/runs', body),
    addStep: (sessionId, body) => post(`/api/v1/runs/${sessionId}/steps`, body),
    compile: (sessionId, body) => post(`/api/v1/runs/${sessionId}/compile`, body),
    getSteps: (publicId) => get(`/api/v1/flows/${publicId}/steps`),
    patchStep: (publicId, stepId, body) => patch(`/api/v1/flows/${publicId}/steps/${stepId}`, body),
    reorderSteps: (publicId, stepIds) => post(`/api/v1/flows/${publicId}/steps/reorder`, { step_ids: stepIds }),
    deleteStep: (publicId, stepId) => del(`/api/v1/flows/${publicId}/steps/${stepId}`),
    getPublicDoc: (publicId) => app.handle(new Request(`${BASE_URL}/api/v1/docs/${publicId}`)),
  };
};

const stepBody = (assetId: string, overrides: Record<string, unknown> = {}) => ({
  asset_id: assetId,
  action: 'click',
  selector: '#save',
  instruction: 'Click Save button',
  ...overrides,
});

const createCompiledFlowWithSteps = async (ws: Workspace, count = 3) => {
  const createRunRes = await ws.createRun({ title: 'Guide Steps Test' });
  const runData: CreateRunResponse = await createRunRes.json();
  const sessionId = runData.session_id;

  for (let i = 1; i <= count; i++) {
    const assetId = await ws.upload();
    const res = await ws.addStep(
      sessionId,
      stepBody(assetId, {
        instruction: `Step ${i} instruction with keyword kelinci${i}`,
        title: `Step Title ${i}`,
        alt: `Step Alt ${i}`,
        box: { x: 10 * i, y: 20 * i, w: 100, h: 50 },
        redaction: { mode: 'off', report: { count: 0, script_version: '1' } },
      }),
    );
    expect(res.status).toBe(201);
  }

  const compileRes = await ws.compile(sessionId);
  expect(compileRes.status).toBe(200);

  const run = await prisma.run.findFirstOrThrow({
    where: { publicId: sessionId },
    select: { flow: { select: { publicId: true, id: true } } },
  });

  return { sessionId, flowPublicId: run.flow.publicId, flowId: run.flow.id };
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

// ========================================================================
// AC-01: Edit step content and highlight on latest run
// ========================================================================
test('GET /api/v1/flows/:publicId/steps returns steps in order', async () => {
  const ws = await workspace(await newApp());
  const { flowPublicId } = await createCompiledFlowWithSteps(ws, 3);

  const res = await ws.getSteps(flowPublicId);
  expect(res.status).toBe(200);

  const body: StepsListResponse = await res.json();
  expect(body.steps).toHaveLength(3);
  expect(body.steps[0].order).toBe(1);
  expect(body.steps[0].title).toBe('Step Title 1');
  expect(body.steps[0].instruction).toContain('Step 1 instruction');
  expect(body.steps[0].box).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  expect(body.steps[1].order).toBe(2);
  expect(body.steps[2].order).toBe(3);
});

test('PATCH /api/v1/flows/:publicId/steps/:stepId saves edited fields and updates search & doc', async () => {
  const ws = await workspace(await newApp());
  const { flowPublicId, flowId } = await createCompiledFlowWithSteps(ws, 2);

  const listRes = await ws.getSteps(flowPublicId);
  const listData: StepsListResponse = await listRes.json();
  const firstStepId = listData.steps[0].id;

  const patchRes = await ws.patchStep(flowPublicId, firstStepId, {
    title: 'Updated Step Title',
    instruction: 'Click the **Updated** button now',
    alt: 'Updated screenshot alt text',
    box: { x: 50, y: 60, w: 200, h: 80 },
  });
  expect(patchRes.status).toBe(200);

  const patchBody: PatchStepResponse = await patchRes.json();
  expect(patchBody.step.title).toBe('Updated Step Title');
  expect(patchBody.step.instruction).toBe('Click the **Updated** button now');
  expect(patchBody.step.alt).toBe('Updated screenshot alt text');
  expect(patchBody.step.box).toEqual({ x: 50, y: 60, w: 200, h: 80 });

  // Verify in public doc
  const docRes = await ws.getPublicDoc(flowPublicId);
  expect(docRes.status).toBe(200);
  const docBody: PublicDocResponse = await docRes.json();
  expect(docBody.steps[0].title).toBe('Updated Step Title');
  expect(docBody.steps[0].instruction).toBe('Click the **Updated** button now');
  expect(docBody.steps[0].alt).toBe('Updated screenshot alt text');
  expect(docBody.steps[0].box?.x).toBe(50);

  // Verify search document refreshed
  const rows = await prisma.$queryRaw<{ search: string }[]>`SELECT search::text FROM "Flow" WHERE id = ${flowId}`;
  expect(rows[0]?.search).not.toBeNull();
  expect(rows[0]?.search).toContain('updated');
});

test('PATCH can toggle highlight off (box: null)', async () => {
  const ws = await workspace(await newApp());
  const { flowPublicId } = await createCompiledFlowWithSteps(ws, 1);

  const listRes = await ws.getSteps(flowPublicId);
  const listData: StepsListResponse = await listRes.json();

  const patchRes = await ws.patchStep(flowPublicId, listData.steps[0].id, {
    box: null,
  });
  expect(patchRes.status).toBe(200);

  const patchBody: PatchStepResponse = await patchRes.json();
  expect(patchBody.step.box).toBeNull();

  // Public doc should not have box
  const docRes = await ws.getPublicDoc(flowPublicId);
  const docBody: PublicDocResponse = await docRes.json();
  expect(docBody.steps[0].box).toBeUndefined();
});

test('PATCH rejects invalid instruction and title lengths', async () => {
  const ws = await workspace(await newApp());
  const { flowPublicId } = await createCompiledFlowWithSteps(ws, 1);
  const listRes = await ws.getSteps(flowPublicId);
  const listData: StepsListResponse = await listRes.json();
  const stepId = listData.steps[0].id;

  // Empty instruction
  const res1 = await ws.patchStep(flowPublicId, stepId, { instruction: '   ' });
  expect(res1.status).toBe(422);

  // Too long title (>120)
  const res2 = await ws.patchStep(flowPublicId, stepId, { title: 'a'.repeat(121) });
  expect(res2.status).toBe(422);

  // Too long alt (>300)
  const res3 = await ws.patchStep(flowPublicId, stepId, { alt: 'a'.repeat(301) });
  expect(res3.status).toBe(422);

  // Invalid box coordinates
  const res4 = await ws.patchStep(flowPublicId, stepId, { box: { x: 'invalid', y: 0, w: 10, h: 10 } });
  expect(res4.status).toBe(422);
});

// ========================================================================
// AC-02: Reorder steps transactionally
// ========================================================================
test('POST /api/v1/flows/:publicId/steps/reorder reverses step order cleanly', async () => {
  const ws = await workspace(await newApp());
  const { flowPublicId } = await createCompiledFlowWithSteps(ws, 3);

  const listRes = await ws.getSteps(flowPublicId);
  const listData: StepsListResponse = await listRes.json();
  const [s1, s2, s3] = listData.steps;

  // Reorder to s3, s1, s2
  const reorderRes = await ws.reorderSteps(flowPublicId, [s3.id, s1.id, s2.id]);
  expect(reorderRes.status).toBe(200);

  const afterRes = await ws.getSteps(flowPublicId);
  const afterData: StepsListResponse = await afterRes.json();

  expect(afterData.steps[0].id).toBe(s3.id);
  expect(afterData.steps[0].order).toBe(1);
  expect(afterData.steps[1].id).toBe(s1.id);
  expect(afterData.steps[1].order).toBe(2);
  expect(afterData.steps[2].id).toBe(s2.id);
  expect(afterData.steps[2].order).toBe(3);

  // Public doc reflects new order
  const docRes = await ws.getPublicDoc(flowPublicId);
  const docData: PublicDocResponse = await docRes.json();
  expect(docData.steps[0].title).toBe('Step Title 3');
  expect(docData.steps[1].title).toBe('Step Title 1');
  expect(docData.steps[2].title).toBe('Step Title 2');
});

test('POST reorder rejects missing or duplicate IDs', async () => {
  const ws = await workspace(await newApp());
  const { flowPublicId } = await createCompiledFlowWithSteps(ws, 3);
  const listRes = await ws.getSteps(flowPublicId);
  const listData: StepsListResponse = await listRes.json();

  // Duplicate ID
  const res1 = await ws.reorderSteps(flowPublicId, [listData.steps[0].id, listData.steps[0].id, listData.steps[1].id]);
  expect(res1.status).toBe(422);

  // Missing ID
  const res2 = await ws.reorderSteps(flowPublicId, [listData.steps[0].id, listData.steps[1].id]);
  expect(res2.status).toBe(422);

  // Foreign ID
  const res3 = await ws.reorderSteps(flowPublicId, [listData.steps[0].id, listData.steps[1].id, 'foreign-uuid']);
  expect(res3.status).toBe(422);
});

// ========================================================================
// AC-03: Hard delete step and renumber remaining steps
// ========================================================================
test('DELETE /api/v1/flows/:publicId/steps/:stepId removes step and renumbers remaining', async () => {
  const ws = await workspace(await newApp());
  const { flowPublicId } = await createCompiledFlowWithSteps(ws, 3);

  const listRes = await ws.getSteps(flowPublicId);
  const listData: StepsListResponse = await listRes.json();
  const stepToDelete = listData.steps[1]; // step 2

  const delRes = await ws.deleteStep(flowPublicId, stepToDelete.id);
  expect(delRes.status).toBe(200);
  const delBody: DeleteStepResponse = await delRes.json();
  expect(delBody.ok).toBe(true);
  expect(delBody.remaining).toBe(2);

  // Check remaining steps: original step 3 should now be order 2
  const afterRes = await ws.getSteps(flowPublicId);
  const afterData: StepsListResponse = await afterRes.json();
  expect(afterData.steps).toHaveLength(2);
  expect(afterData.steps[0].title).toBe('Step Title 1');
  expect(afterData.steps[0].order).toBe(1);
  expect(afterData.steps[1].title).toBe('Step Title 3');
  expect(afterData.steps[1].order).toBe(2);

  // Public doc
  const docRes = await ws.getPublicDoc(flowPublicId);
  const docData: PublicDocResponse = await docRes.json();
  expect(docData.steps).toHaveLength(2);
  expect(docData.steps[0].order).toBe(1);
  expect(docData.steps[1].order).toBe(2);
});

// ========================================================================
// AC-06: Authorization and validation guards
// ========================================================================
test('unauthenticated request returns 401', async () => {
  const ws = await workspace(await newApp());
  const { flowPublicId } = await createCompiledFlowWithSteps(ws, 1);

  const unauthRes = await ws.app.handle(new Request(`${BASE_URL}/api/v1/flows/${flowPublicId}/steps`));
  expect(unauthRes.status).toBe(401);
});

test('request from another workspace returns 404', async () => {
  const app = await newApp();
  const ws1 = await workspace(app);
  const ws2 = await workspace(app, OTHER_GITHUB_ACCOUNT);

  const { flowPublicId } = await createCompiledFlowWithSteps(ws1, 1);

  // ws2 tries to access ws1's guide steps
  const res = await ws2.getSteps(flowPublicId);
  expect(res.status).toBe(404);
});

test('editor role is authorized to edit and reorder steps', async () => {
  const ws = await workspace(await newApp());
  const { flowPublicId } = await createCompiledFlowWithSteps(ws, 2);

  // Change member role to editor
  await prisma.member.updateMany({ where: { organizationId: ws.organizationId }, data: { role: 'editor' } });

  const listRes = await ws.getSteps(flowPublicId);
  expect(listRes.status).toBe(200);
  const listData: StepsListResponse = await listRes.json();

  const patchRes = await ws.patchStep(flowPublicId, listData.steps[0].id, { title: 'Editor Edit' });
  expect(patchRes.status).toBe(200);
});

// ========================================================================
// Finding 2: Per-step show/hide (UI-A16 Finding 2)
// ========================================================================
test('steps list returns hidden status, PATCH toggles hidden, and hidden steps are omitted from public doc and renumbered', async () => {
  const ws = await workspace(await newApp());
  const { flowPublicId } = await createCompiledFlowWithSteps(ws, 3);

  // 1. Initial steps all have hidden: false
  const listRes1 = await ws.getSteps(flowPublicId);
  expect(listRes1.status).toBe(200);
  const listData1: StepsListResponse = await listRes1.json();
  expect(listData1.steps).toHaveLength(3);
  expect(listData1.steps[0].hidden).toBe(false);
  expect(listData1.steps[1].hidden).toBe(false);
  expect(listData1.steps[2].hidden).toBe(false);

  // 2. Reject non-boolean hidden
  const invalidPatch = await ws.patchStep(flowPublicId, listData1.steps[1].id, { hidden: 'yes' });
  expect(invalidPatch.status).toBe(422);

  // 3. Hide step 2
  const patchRes = await ws.patchStep(flowPublicId, listData1.steps[1].id, { hidden: true });
  expect(patchRes.status).toBe(200);
  const patchData: PatchStepResponse = await patchRes.json();
  expect(patchData.step.hidden).toBe(true);

  // 4. Admin steps list still lists all 3 steps
  const listRes2 = await ws.getSteps(flowPublicId);
  const listData2: StepsListResponse = await listRes2.json();
  expect(listData2.steps).toHaveLength(3);
  expect(listData2.steps[0].hidden).toBe(false);
  expect(listData2.steps[1].hidden).toBe(true);
  expect(listData2.steps[2].hidden).toBe(false);

  // 5. Public doc omits hidden step and renumbers remaining steps 1, 2
  const docRes = await ws.getPublicDoc(flowPublicId);
  expect(docRes.status).toBe(200);
  const docData: PublicDocResponse = await docRes.json();
  expect(docData.steps).toHaveLength(2);
  expect(docData.steps[0].order).toBe(1);
  expect(docData.steps[0].title).toBe('Step Title 1');
  expect(docData.steps[1].order).toBe(2);
  expect(docData.steps[1].title).toBe('Step Title 3');

  // 6. Public doc markdown omits hidden step and renumbers
  const mdRes = await ws.app.handle(new Request(`${BASE_URL}/api/v1/docs/${flowPublicId}/markdown`));
  expect(mdRes.status).toBe(200);
  const mdText = await mdRes.text();
  expect(mdText).toContain('## Step 1: Step Title 1');
  expect(mdText).toContain('## Step 2: Step Title 3');
  expect(mdText).not.toContain('Step Title 2');

  // 7. Unhide step 2
  const unhideRes = await ws.patchStep(flowPublicId, listData1.steps[1].id, { hidden: false });
  expect(unhideRes.status).toBe(200);
  const unhideData: PatchStepResponse = await unhideRes.json();
  expect(unhideData.step.hidden).toBe(false);

  // Public doc now shows all 3 steps again
  const docResAfter = await ws.getPublicDoc(flowPublicId);
  const docDataAfter: PublicDocResponse = await docResAfter.json();
  expect(docDataAfter.steps).toHaveLength(3);
  expect(docDataAfter.steps[1].order).toBe(2);
  expect(docDataAfter.steps[1].title).toBe('Step Title 2');
});
