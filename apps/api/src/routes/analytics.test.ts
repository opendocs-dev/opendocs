import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import {
  BASE_URL,
  cleanDatabase,
  realFetch,
  signIn,
  type App,
} from '../../test/helpers';
import { recordHelpfulVote, recordSearch, recordView } from '../analytics/events';
import { getPrisma } from '../db';
import { createApp } from '../index';

const prisma = getPrisma();

let app: App;
beforeEach(async () => {
  await cleanDatabase();
  app = createApp(async () => {});
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  await cleanDatabase();
});

const setupWorkspace = async () => {
  const cookie = await signIn(app);
  const meRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/me`, { headers: { cookie } }),
  );
  const me = (await meRes.json()) as { workspace: { id: string; name: string; slug: string } };
  return { cookie, orgId: me.workspace.id, slug: me.workspace.slug };
};

const createFlow = async (orgId: string, title: string, slug: string) => {
  return prisma.flow.create({
    data: {
      publicId: `flow_${crypto.randomUUID().slice(0, 8)}`,
      organizationId: orgId,
      title,
      slug,
      visibility: 'published',
      latestRunId: `run_${crypto.randomUUID().slice(0, 8)}`,
    },
  });
};

test('GET /api/v1/analytics requires authenticated session and member', async () => {
  const unauthRes = await app.handle(new Request(`${BASE_URL}/api/v1/analytics`));
  expect(unauthRes.status).toBe(401);

  const ws = await setupWorkspace();
  const res = await app.handle(
    new Request(`${BASE_URL}/api/v1/analytics`, { headers: { cookie: ws.cookie } }),
  );
  expect(res.status).toBe(200);
});

test('GET /api/v1/analytics accepts 7, 30, 90 days and defaults to 30', async () => {
  const ws = await setupWorkspace();

  const defRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/analytics`, { headers: { cookie: ws.cookie } }),
  );
  const defBody = (await defRes.json()) as { days: number; views_per_day: unknown[] };
  expect(defBody.days).toBe(30);
  expect(defBody.views_per_day.length).toBe(30);

  const sevenRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/analytics?days=7`, { headers: { cookie: ws.cookie } }),
  );
  const sevenBody = (await sevenRes.json()) as { days: number; views_per_day: unknown[] };
  expect(sevenBody.days).toBe(7);
  expect(sevenBody.views_per_day.length).toBe(7);

  const ninetyRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/analytics?days=90`, { headers: { cookie: ws.cookie } }),
  );
  const ninetyBody = (await ninetyRes.json()) as { days: number; views_per_day: unknown[] };
  expect(ninetyBody.days).toBe(90);
  expect(ninetyBody.views_per_day.length).toBe(90);
});

test('records views and aggregates top guides and views_per_day', async () => {
  const ws = await setupWorkspace();
  const flowA = await createFlow(ws.orgId, 'Guide A', 'guide-a');
  const flowB = await createFlow(ws.orgId, 'Guide B', 'guide-b');

  await recordView(flowA.id);
  await recordView(flowA.id);
  await recordView(flowB.id);

  const res = await app.handle(
    new Request(`${BASE_URL}/api/v1/analytics`, { headers: { cookie: ws.cookie } }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    views: number;
    top_guides: Array<{ title: string; views: number }>;
  };

  expect(body.views).toBe(3);
  expect(body.top_guides.length).toBe(2);
  expect(body.top_guides[0]?.title).toBe('Guide A');
  expect(body.top_guides[0]?.views).toBe(2);
  expect(body.top_guides[1]?.title).toBe('Guide B');
  expect(body.top_guides[1]?.views).toBe(1);
});

test('records searches, calculates percentage with results, and isolates queries with no results', async () => {
  const ws = await setupWorkspace();
  const flow = await createFlow(ws.orgId, 'Template guide', 'template-guide');

  // 2 searches with results, 1 without
  await recordSearch(ws.orgId, 'Template', 3, [flow.id]);
  await recordSearch(ws.orgId, 'template', 3, [flow.id]);
  await recordSearch(ws.orgId, 'Refund', 0, []);

  const res = await app.handle(
    new Request(`${BASE_URL}/api/v1/analytics`, { headers: { cookie: ws.cookie } }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    searches: number;
    searches_with_results_percent: number;
    top_searches: Array<{ query: string; times: number; results: number }>;
    searches_without_results: Array<{ query: string; times: number }>;
  };

  expect(body.searches).toBe(3);
  expect(body.searches_with_results_percent).toBe(67); // 2 of 3 = 67%
  expect(body.top_searches[0]?.query).toBe('template');
  expect(body.top_searches[0]?.times).toBe(2);
  expect(body.searches_without_results[0]?.query).toBe('refund');
  expect(body.searches_without_results[0]?.times).toBe(1);
});

test('records helpful votes and calculates marked_helpful_percent', async () => {
  const ws = await setupWorkspace();
  const flow = await createFlow(ws.orgId, 'Helpful guide', 'helpful-guide');

  await recordHelpfulVote(flow.id, true);
  await recordHelpfulVote(flow.id, true);
  await recordHelpfulVote(flow.id, false);

  const res = await app.handle(
    new Request(`${BASE_URL}/api/v1/analytics`, { headers: { cookie: ws.cookie } }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { marked_helpful_percent: number };
  // 2 yes out of 3 votes = 67%
  expect(body.marked_helpful_percent).toBe(67);
});

test('public endpoint POST /api/v1/site/guides/:guideSlug/view records a view', async () => {
  const ws = await setupWorkspace();
  const flow = await createFlow(ws.orgId, 'Public Guide', 'public-guide');

  const viewRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/site/guides/${flow.slug}/view`, {
      method: 'POST',
    }),
  );
  expect(viewRes.status).toBe(200);
  expect(await viewRes.json()).toEqual({ ok: true });

  const daily = await prisma.analyticsDaily.findFirst({
    where: { flowId: flow.id },
  });
  expect(daily?.views).toBe(1);
});

test('public endpoint POST /api/v1/site/guides/:guideSlug/vote records votes and rejects non-boolean', async () => {
  const ws = await setupWorkspace();
  const flow = await createFlow(ws.orgId, 'Voted Guide', 'voted-guide');

  const badRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/site/guides/${flow.slug}/vote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ helpful: 'yes' }),
    }),
  );
  expect(badRes.status).toBe(422);

  const voteYesRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/site/guides/${flow.slug}/vote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ helpful: true }),
    }),
  );
  expect(voteYesRes.status).toBe(200);

  const voteNoRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/site/guides/${flow.slug}/vote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ helpful: false }),
    }),
  );
  expect(voteNoRes.status).toBe(200);

  const daily = await prisma.analyticsDaily.findFirst({
    where: { flowId: flow.id },
  });
  expect(daily?.helpfulYes).toBe(1);
  expect(daily?.helpfulNo).toBe(1);
});

test('Overview endpoint returns views_30d, searches, and storage_used', async () => {
  const ws = await setupWorkspace();
  const flow = await createFlow(ws.orgId, 'Overview flow', 'overview-flow');
  await recordView(flow.id);
  await recordSearch(ws.orgId, 'sample query', 1, [flow.id]);

  const res = await app.handle(
    new Request(`${BASE_URL}/api/v1/overview`, { headers: { cookie: ws.cookie } }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    published: number;
    views_30d: number;
    searches: number;
    storage_used: string;
  };
  expect(body.published).toBe(1);
  expect(body.views_30d).toBe(1);
  expect(body.searches).toBe(1);
  expect(typeof body.storage_used).toBe('string');
});

test('AnalyticsDaily and SearchLog tables contain no PII', async () => {
  const ws = await setupWorkspace();
  const flow = await createFlow(ws.orgId, 'Clean flow', 'clean-flow');
  await recordView(flow.id);
  await recordSearch(ws.orgId, 'my search', 1);

  const dailyRows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "AnalyticsDaily" WHERE "flowId" = ${flow.id}
  `;
  const searchRows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "SearchLog" WHERE "organizationId" = ${ws.orgId}
  `;

  expect(dailyRows.length).toBe(1);
  expect(searchRows.length).toBe(1);

  const dailyCols = Object.keys(dailyRows[0] ?? {});
  const searchCols = Object.keys(searchRows[0] ?? {});

  // Confirm no visitor IP, user agent, email, or cookie columns exist
  const forbiddenPatterns = ['ip', 'user_agent', 'cookie', 'email', 'visitor'];
  for (const col of [...dailyCols, ...searchCols]) {
    for (const pattern of forbiddenPatterns) {
      expect(col.toLowerCase()).not.toContain(pattern);
    }
  }
});
