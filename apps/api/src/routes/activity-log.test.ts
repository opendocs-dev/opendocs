import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { BASE_URL, cleanDatabase, GITHUB_ACCOUNT, OTHER_GITHUB_ACCOUNT, realFetch, signIn, type App } from '../../test/helpers';
import { getPrisma } from '../db';
import { createApp } from '../index';

const prisma = getPrisma();

const newApp = (): App => createApp(async () => {});

const workspace = async (app: App) => {
  const cookie = await signIn(app, GITHUB_ACCOUNT);
  const owner = await prisma.member.findFirstOrThrow({ where: { role: 'owner' } });
  return { app, cookie, organizationId: owner.organizationId, userId: owner.userId };
};

const get = (app: App, path: string, cookie: string) =>
  app.handle(new Request(`${BASE_URL}${path}`, { headers: { cookie } }));

beforeEach(async () => {
  await cleanDatabase();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  await cleanDatabase();
});

test('GET /api/v1/activity-log returns 401 without session', async () => {
  const app = newApp();
  const response = await app.handle(new Request(`${BASE_URL}/api/v1/activity-log`));
  expect(response.status).toBe(401);
});

test('GET /api/v1/activity-log as owner or admin succeeds', async () => {
  const ws = await workspace(newApp());

  // Record an audit log for this organization
  await prisma.auditLog.create({
    data: {
      actorKind: 'user',
      actorId: ws.userId,
      organizationId: ws.organizationId,
      action: 'Changed the site look to Atlas',
      detail: { type: 'site' },
    },
  });

  const response = await get(ws.app, '/api/v1/activity-log', ws.cookie);
  expect(response.status).toBe(200);

  const body = (await response.json()) as {
    activity_logs: Array<{ action: string; type: string }>;
    retention_days: number;
    can_export: boolean;
  };

  expect(body.activity_logs.length).toBe(1);
  expect(body.activity_logs[0].action).toBe('Changed the site look to Atlas');
  expect(body.retention_days).toBe(30);
  expect(body.can_export).toBe(false);

  // Admin role check
  await prisma.member.updateMany({ where: { organizationId: ws.organizationId }, data: { role: 'admin' } });
  const adminRes = await get(ws.app, '/api/v1/activity-log', ws.cookie);
  expect(adminRes.status).toBe(200);
});

test('GET /api/v1/activity-log as editor returns 403', async () => {
  const ws = await workspace(newApp());
  await prisma.member.updateMany({ where: { organizationId: ws.organizationId }, data: { role: 'editor' } });

  const response = await get(ws.app, '/api/v1/activity-log', ws.cookie);
  expect(response.status).toBe(403);
});

test('retention limits: free/pro plan sees 30 days, enterprise sees 365 days', async () => {
  const ws = await workspace(newApp());

  const now = Date.now();
  const tenDaysAgo = new Date(now - 10 * 86400000);
  const fortyDaysAgo = new Date(now - 40 * 86400000);

  await prisma.auditLog.create({
    data: {
      actorKind: 'user',
      actorId: ws.userId,
      organizationId: ws.organizationId,
      action: 'Recent action (10 days ago)',
      createdAt: tenDaysAgo,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorKind: 'user',
      actorId: ws.userId,
      organizationId: ws.organizationId,
      action: 'Older action (40 days ago)',
      createdAt: fortyDaysAgo,
    },
  });

  // Free plan (default)
  const freeRes = await get(ws.app, '/api/v1/activity-log', ws.cookie);
  expect(freeRes.status).toBe(200);
  const freeBody = (await freeRes.json()) as { activity_logs: Array<{ action: string }>; retention_days: number };
  expect(freeBody.retention_days).toBe(30);
  expect(freeBody.activity_logs.length).toBe(1);
  expect(freeBody.activity_logs[0].action).toBe('Recent action (10 days ago)');

  // Upgrade to Enterprise
  await prisma.workspaceBilling.upsert({
    where: { organizationId: ws.organizationId },
    update: { plan: 'enterprise' },
    create: { organizationId: ws.organizationId, plan: 'enterprise' },
  });

  const enterpriseRes = await get(ws.app, '/api/v1/activity-log', ws.cookie);
  expect(enterpriseRes.status).toBe(200);
  const entBody = (await enterpriseRes.json()) as { activity_logs: Array<{ action: string }>; retention_days: number; can_export: boolean };
  expect(entBody.retention_days).toBe(365);
  expect(entBody.can_export).toBe(true);
  expect(entBody.activity_logs.length).toBe(2);
});

test('filters activity logs by person and by type', async () => {
  const ws = await workspace(newApp());

  await prisma.auditLog.create({
    data: {
      actorKind: 'user',
      actorId: ws.userId,
      organizationId: ws.organizationId,
      action: 'User updated guide',
      detail: { type: 'guides' },
    },
  });

  await prisma.auditLog.create({
    data: {
      actorKind: 'apikey',
      actorId: 'key_123',
      organizationId: ws.organizationId,
      action: 'API key published guide',
      detail: { type: 'guides' },
    },
  });

  await prisma.auditLog.create({
    data: {
      actorKind: 'user',
      actorId: ws.userId,
      organizationId: ws.organizationId,
      action: 'User updated site',
      detail: { type: 'site' },
    },
  });

  // Filter by person = apikey
  const apikeyRes = await get(ws.app, '/api/v1/activity-log?person=apikey', ws.cookie);
  const apikeyBody = (await apikeyRes.json()) as { activity_logs: Array<{ actor_kind: string }> };
  expect(apikeyBody.activity_logs.length).toBe(1);
  expect(apikeyBody.activity_logs[0].actor_kind).toBe('apikey');

  // Filter by type = site
  const siteRes = await get(ws.app, '/api/v1/activity-log?type=site', ws.cookie);
  const siteBody = (await siteRes.json()) as { activity_logs: Array<{ action: string }> };
  expect(siteBody.activity_logs.length).toBe(1);
  expect(siteBody.activity_logs[0].action).toBe('User updated site');
});

test('GET /api/v1/activity-log/export returns 403 on non-enterprise, CSV on enterprise', async () => {
  const ws = await workspace(newApp());

  await prisma.auditLog.create({
    data: {
      actorKind: 'user',
      actorId: ws.userId,
      organizationId: ws.organizationId,
      action: 'Some change',
    },
  });

  // Free plan returns 403
  const freeRes = await get(ws.app, '/api/v1/activity-log/export', ws.cookie);
  expect(freeRes.status).toBe(403);

  // Upgrade to enterprise
  await prisma.workspaceBilling.upsert({
    where: { organizationId: ws.organizationId },
    update: { plan: 'enterprise' },
    create: { organizationId: ws.organizationId, plan: 'enterprise' },
  });

  const entRes = await get(ws.app, '/api/v1/activity-log/export', ws.cookie);
  expect(entRes.status).toBe(200);
  expect(entRes.headers.get('content-type')).toContain('text/csv');
  const text = await entRes.text();
  expect(text).toContain('When,Who,What');
  expect(text).toContain('Some change');
});

test('activity log cannot be modified or deleted via UI/API (immutability)', async () => {
  const ws = await workspace(newApp());

  const postRes = await ws.app.handle(
    new Request(`${BASE_URL}/api/v1/activity-log`, {
      method: 'POST',
      headers: { cookie: ws.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'fake' }),
    }),
  );
  expect(postRes.status).toBeGreaterThanOrEqual(404);

  const deleteRes = await ws.app.handle(
    new Request(`${BASE_URL}/api/v1/activity-log/some-id`, {
      method: 'DELETE',
      headers: { cookie: ws.cookie },
    }),
  );
  expect(deleteRes.status).toBeGreaterThanOrEqual(404);
});
test('regression: audit logs persist with null organizationId when organization is deleted', async () => {
  const ws = await workspace(newApp());

  const auditEntry = await prisma.auditLog.create({
    data: {
      actorKind: 'user',
      actorId: ws.userId,
      organizationId: ws.organizationId,
      action: 'Important compliance action before workspace deletion',
      detail: { note: 'compliance archive' },
    },
  });

  // Delete the organization
  await prisma.organization.delete({
    where: { id: ws.organizationId },
  });

  // Verify the audit log record still exists in the database!
  const survivingLog = await prisma.auditLog.findUnique({
    where: { id: auditEntry.id },
  });

  expect(survivingLog).not.toBeNull();
  expect(survivingLog?.id).toBe(auditEntry.id);
  expect(survivingLog?.organizationId).toBeNull();
  expect(survivingLog?.action).toBe('Important compliance action before workspace deletion');
});

test('paging: default 50 per page, cursor pagination, stable ordering and no duplicates', async () => {
  const ws = await workspace(newApp());

  // Create 65 audit logs with staggered timestamps
  const baseTime = Date.now() - 5 * 86400000;
  const logsData = Array.from({ length: 65 }, (_, i) => ({
    actorKind: 'user',
    actorId: ws.userId,
    organizationId: ws.organizationId,
    action: `Action ${i + 1}`,
    createdAt: new Date(baseTime + i * 60000),
  }));

  await prisma.auditLog.createMany({
    data: logsData,
  });

  // Page 1: default limit is 50
  const page1Res = await get(ws.app, '/api/v1/activity-log', ws.cookie);
  expect(page1Res.status).toBe(200);
  const page1 = (await page1Res.json()) as {
    activity_logs: Array<{ id: string; action: string; created_at: string }>;
    has_more: boolean;
    next_cursor: string | null;
  };

  expect(page1.activity_logs.length).toBe(50);
  expect(page1.has_more).toBe(true);
  expect(page1.next_cursor).toBe(page1.activity_logs[49].id);

  // Page 2: pass cursor
  const page2Res = await get(ws.app, `/api/v1/activity-log?cursor=${page1.next_cursor}`, ws.cookie);
  expect(page2Res.status).toBe(200);
  const page2 = (await page2Res.json()) as {
    activity_logs: Array<{ id: string; action: string; created_at: string }>;
    has_more: boolean;
    next_cursor: string | null;
  };

  expect(page2.activity_logs.length).toBe(15);
  expect(page2.has_more).toBe(false);
  expect(page2.next_cursor).toBeNull();

  // No duplicates across pages
  const page1Ids = page1.activity_logs.map((l) => l.id);
  const page2Ids = page2.activity_logs.map((l) => l.id);
  const allIds = [...page1Ids, ...page2Ids];
  expect(new Set(allIds).size).toBe(65);

  // Stable descending order (newest first)
  for (let i = 0; i < allIds.length - 1; i++) {
    const current = i < 50 ? page1.activity_logs[i] : page2.activity_logs[i - 50];
    const next = i + 1 < 50 ? page1.activity_logs[i + 1] : page2.activity_logs[i + 1 - 50];
    const currTime = new Date(current.created_at).getTime();
    const nextTime = new Date(next.created_at).getTime();
    expect(currTime >= nextTime).toBe(true);
  }
});

test('paging: stable ordering and no duplicates with identical timestamps', async () => {
  const ws = await workspace(newApp());

  const sameTime = new Date();
  const logsData = Array.from({ length: 55 }, (_, i) => ({
    actorKind: 'user',
    actorId: ws.userId,
    organizationId: ws.organizationId,
    action: `Simultaneous action ${i + 1}`,
    createdAt: sameTime,
  }));

  await prisma.auditLog.createMany({
    data: logsData,
  });

  const page1Res = await get(ws.app, '/api/v1/activity-log', ws.cookie);
  const page1 = (await page1Res.json()) as {
    activity_logs: Array<{ id: string }>;
    has_more: boolean;
    next_cursor: string | null;
  };

  expect(page1.activity_logs.length).toBe(50);
  expect(page1.has_more).toBe(true);

  const page2Res = await get(ws.app, `/api/v1/activity-log?cursor=${page1.next_cursor}`, ws.cookie);
  const page2 = (await page2Res.json()) as {
    activity_logs: Array<{ id: string }>;
    has_more: boolean;
    next_cursor: string | null;
  };

  expect(page2.activity_logs.length).toBe(5);
  expect(page2.has_more).toBe(false);

  // Check uniqueness across pages
  const combined = [...page1.activity_logs.map((l) => l.id), ...page2.activity_logs.map((l) => l.id)];
  expect(new Set(combined).size).toBe(55);
});

test('paging: offset and limit pagination', async () => {
  const ws = await workspace(newApp());

  const baseTime = Date.now() - 2 * 86400000;
  await prisma.auditLog.createMany({
    data: Array.from({ length: 30 }, (_, i) => ({
      actorKind: 'user',
      actorId: ws.userId,
      organizationId: ws.organizationId,
      action: `Log ${i}`,
      createdAt: new Date(baseTime + i * 10000),
    })),
  });

  const res1 = await get(ws.app, '/api/v1/activity-log?limit=12&offset=0', ws.cookie);
  const b1 = (await res1.json()) as { activity_logs: Array<{ id: string }>; has_more: boolean };
  expect(b1.activity_logs.length).toBe(12);
  expect(b1.has_more).toBe(true);

  const res2 = await get(ws.app, '/api/v1/activity-log?limit=12&offset=12', ws.cookie);
  const b2 = (await res2.json()) as { activity_logs: Array<{ id: string }>; has_more: boolean };
  expect(b2.activity_logs.length).toBe(12);
  expect(b2.has_more).toBe(true);

  const res3 = await get(ws.app, '/api/v1/activity-log?limit=12&offset=24', ws.cookie);
  const b3 = (await res3.json()) as { activity_logs: Array<{ id: string }>; has_more: boolean };
  expect(b3.activity_logs.length).toBe(6);
  expect(b3.has_more).toBe(false);

  const ids = [...b1.activity_logs, ...b2.activity_logs, ...b3.activity_logs].map((l) => l.id);
  expect(new Set(ids).size).toBe(30);
});

test('paging: preserves filters with cursor pagination', async () => {
  const ws = await workspace(newApp());

  // Create 55 guides actions and 20 site actions
  const baseTime = Date.now() - 3 * 86400000;
  await prisma.auditLog.createMany({
    data: [
      ...Array.from({ length: 55 }, (_, i) => ({
        actorKind: 'user',
        actorId: ws.userId,
        organizationId: ws.organizationId,
        action: `Guide action ${i}`,
        detail: { type: 'guides' },
        createdAt: new Date(baseTime + i * 1000),
      })),
      ...Array.from({ length: 20 }, (_, i) => ({
        actorKind: 'user',
        actorId: ws.userId,
        organizationId: ws.organizationId,
        action: `Site action ${i}`,
        detail: { type: 'site' },
        createdAt: new Date(baseTime + (i + 100) * 1000),
      })),
    ],
  });

  // Fetch page 1 with type=guides filter
  const p1Res = await get(ws.app, '/api/v1/activity-log?type=guides', ws.cookie);
  const p1 = (await p1Res.json()) as {
    activity_logs: Array<{ id: string; type: string }>;
    has_more: boolean;
    next_cursor: string | null;
  };
  expect(p1.activity_logs.length).toBe(50);
  expect(p1.activity_logs.every((l) => l.type === 'guides')).toBe(true);
  expect(p1.has_more).toBe(true);

  // Fetch page 2 keeping type=guides filter and cursor
  const p2Res = await get(ws.app, `/api/v1/activity-log?type=guides&cursor=${p1.next_cursor}`, ws.cookie);
  const p2 = (await p2Res.json()) as {
    activity_logs: Array<{ id: string; type: string }>;
    has_more: boolean;
    next_cursor: string | null;
  };
  expect(p2.activity_logs.length).toBe(5);
  expect(p2.activity_logs.every((l) => l.type === 'guides')).toBe(true);
  expect(p2.has_more).toBe(false);
  expect(p2.next_cursor).toBeNull();
});

test('paging: invalid cursor returns 400 validation_failed', async () => {
  const ws = await workspace(newApp());
  const res = await get(ws.app, '/api/v1/activity-log?cursor=invalid-uuid-or-id', ws.cookie);
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: { code: string } };
  expect(body.error.code).toBe('validation_failed');
});
