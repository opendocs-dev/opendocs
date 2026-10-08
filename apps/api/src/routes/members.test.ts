import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import {
  BASE_URL,
  cleanDatabase,
  GITHUB_ACCOUNT,
  OTHER_GITHUB_ACCOUNT,
  realFetch,
  signIn,
  type App,
} from '../../test/helpers';
import { getPrisma } from '../db';
import { createApp } from '../index';
import { _resetLastActiveCacheForTest, touchMemberLastActive } from '../site/session';

const prisma = getPrisma();

const errorCode = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

const newApp = (): App => createApp(async () => {});

const workspace = async (app: App) => {
  const cookie = await signIn(app, GITHUB_ACCOUNT);
  const owner = await prisma.member.findFirstOrThrow({ where: { role: 'owner' } });
  return { app, cookie, organizationId: owner.organizationId };
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

test('GET /api/v1/members as owner lists members only, with no invitations', async () => {
  const ws = await workspace(newApp());
  await signIn(ws.app, OTHER_GITHUB_ACCOUNT);

  const response = await get(ws.app, '/api/v1/members', ws.cookie);
  expect(response.status).toBe(200);

  const body = (await response.json()) as {
    members: Array<{ role: string; email: string }>;
    invitations?: unknown;
  };
  expect(Object.keys(body)).toEqual(['members']);
  expect(body.members).toHaveLength(2);
  expect(body.members.map((m) => m.role).sort()).toEqual(['editor', 'owner']);
  expect(body.members.find((m) => m.email === OTHER_GITHUB_ACCOUNT.email)?.role).toBe('editor');
});

test('GET /api/v1/members includes last_active_at and touchMemberLastActive updates it at most once per hour', async () => {
  _resetLastActiveCacheForTest();
  const ws = await workspace(newApp());
  const owner = await prisma.member.findFirstOrThrow({ where: { organizationId: ws.organizationId } });

  // Initially null
  expect(owner.lastActiveAt).toBeNull();

  // First touch updates lastActiveAt
  await touchMemberLastActive(owner.userId, ws.organizationId);
  const updated1 = await prisma.member.findUniqueOrThrow({ where: { id: owner.id } });
  expect(updated1.lastActiveAt).not.toBeNull();
  const firstActiveTime = updated1.lastActiveAt!.getTime();

  // Immediate second touch does not write to DB
  await touchMemberLastActive(owner.userId, ws.organizationId);
  const updated2 = await prisma.member.findUniqueOrThrow({ where: { id: owner.id } });
  expect(updated2.lastActiveAt!.getTime()).toBe(firstActiveTime);

  // Response includes last_active_at
  const response = await get(ws.app, '/api/v1/members', ws.cookie);
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    members: Array<{ id: string; last_active_at: string | null }>;
  };
  expect(body.members[0].last_active_at).toBe(updated1.lastActiveAt!.toISOString());
});

test('GET /api/v1/members as admin succeeds', async () => {
  const ws = await workspace(newApp());
  await prisma.member.updateMany({ where: { organizationId: ws.organizationId }, data: { role: 'admin' } });

  const response = await get(ws.app, '/api/v1/members', ws.cookie);
  expect(response.status).toBe(200);
});

test('GET /api/v1/members as editor returns 403', async () => {
  const ws = await workspace(newApp());
  await prisma.member.updateMany({ where: { organizationId: ws.organizationId }, data: { role: 'editor' } });

  const response = await get(ws.app, '/api/v1/members', ws.cookie);
  expect(response.status).toBe(403);
  expect(await errorCode(response)).toBe('unauthorized');
});

test('GET /api/v1/members as legacy "member" role returns 403 (normalized to editor)', async () => {
  const ws = await workspace(newApp());
  await prisma.member.updateMany({ where: { organizationId: ws.organizationId }, data: { role: 'member' } });

  const response = await get(ws.app, '/api/v1/members', ws.cookie);
  expect(response.status).toBe(403);
});

test('GET /api/v1/members requires a session', async () => {
  const app = newApp();
  const response = await app.handle(new Request(`${BASE_URL}/api/v1/members`));
  expect(response.status).toBe(401);
});

const refusedOrganizationEndpoints: Array<[string, (ws: { organizationId: string; ownerId: string }) => unknown]> = [
  ['update-member-role', (ws) => ({ memberId: ws.ownerId, role: 'editor', organizationId: ws.organizationId })],
  ['remove-member', (ws) => ({ memberIdOrEmail: ws.ownerId, organizationId: ws.organizationId })],
  ['leave', (ws) => ({ organizationId: ws.organizationId })],
  ['invite-member', (ws) => ({ email: 'new-hire@example.com', role: 'editor', organizationId: ws.organizationId })],
];

for (const [endpoint, makeBody] of refusedOrganizationEndpoints) {
  test(`POST /api/auth/organization/${endpoint} is refused with 404 and changes nothing`, async () => {
    const ws = await workspace(newApp());
    const owner = await prisma.member.findFirstOrThrow({ where: { organizationId: ws.organizationId } });

    const response = await ws.app.handle(
      new Request(`${BASE_URL}/api/auth/organization/${endpoint}`, {
        method: 'POST',
        headers: { cookie: ws.cookie, 'content-type': 'application/json' },
        body: JSON.stringify(makeBody({ organizationId: ws.organizationId, ownerId: owner.id })),
      }),
    );

    expect(response.status).toBe(404);
    const stillOwner = await prisma.member.findUniqueOrThrow({ where: { id: owner.id } });
    expect(stillOwner.role).toBe('owner');
    expect(await prisma.member.count()).toBe(1);
  });
}
