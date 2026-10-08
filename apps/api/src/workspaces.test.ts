import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import {
  BASE_URL,
  GITHUB_ACCOUNT,
  OTHER_GITHUB_ACCOUNT,
  cleanDatabase,
  realFetch,
  signIn,
  type App,
} from '../test/helpers';
import { getPrisma } from './db';
import { createApp } from './index';

const prisma = getPrisma();

beforeEach(async () => {
  await cleanDatabase();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  await cleanDatabase();
});

test('lists workspaces the user is a member of', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);

  // User already has 1 personal workspace
  const res = await app.handle(
    new Request(`${BASE_URL}/api/auth/organization/list`, {
      headers: { cookie },
    }),
  );
  expect(res.status).toBe(200);
  const list = (await res.json()) as Array<{ id: string; name: string; slug: string }>;
  expect(list).toHaveLength(1);
  expect(list[0]!.name).toBe(GITHUB_ACCOUNT.name);

  // Also via /api/v1/workspaces
  const v1Res = await app.handle(
    new Request(`${BASE_URL}/api/v1/workspaces`, {
      headers: { cookie },
    }),
  );
  expect(v1Res.status).toBe(200);
  const v1List = (await v1Res.json()) as { workspaces: Array<{ id: string; name: string; is_active: boolean }> };
  expect(v1List.workspaces).toHaveLength(1);
  expect(v1List.workspaces[0]!.is_active).toBe(true);
});

test('switches active organization when user is a member', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const user = await prisma.user.findFirstOrThrow();
  const org1 = await prisma.organization.findFirstOrThrow();

  // Create second organization and add user as owner
  const org2 = await prisma.organization.create({
    data: {
      id: crypto.randomUUID(),
      name: 'Second Workspace',
      slug: 'second-workspace',
      members: {
        create: {
          id: crypto.randomUUID(),
          userId: user.id,
          role: 'owner',
        },
      },
      billing: {
        create: {
          plan: 'free',
        },
      },
    },
  });

  // Switch to org2 via Better-Auth
  const switchRes = await app.handle(
    new Request(`${BASE_URL}/api/auth/organization/set-active`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ organizationId: org2.id }),
    }),
  );
  expect(switchRes.status).toBe(200);

  // Verify /api/v1/me now reflects org2
  const meRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/me`, {
      headers: { cookie },
    }),
  );
  expect(meRes.status).toBe(200);
  const me = (await meRes.json()) as { workspace: { id: string; name: string } };
  expect(me.workspace.id).toBe(org2.id);
  expect(me.workspace.name).toBe('Second Workspace');

  // Switch back to org1
  const switchBack = await app.handle(
    new Request(`${BASE_URL}/api/v1/workspaces/switch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ organizationId: org1.id }),
    }),
  );
  expect(switchBack.status).toBe(200);

  const meBack = await app.handle(
    new Request(`${BASE_URL}/api/v1/me`, {
      headers: { cookie },
    }),
  );
  const meBackBody = (await meBack.json()) as { workspace: { id: string; name: string } };
  expect(meBackBody.workspace.id).toBe(org1.id);
});

test('switching to a workspace the user is NOT a member of returns 403', async () => {
  const app = createApp(async () => {});
  // User 1 signs in
  const cookie1 = await signIn(app);
  const org1 = await prisma.organization.findFirstOrThrow();

  // User 2 signs in
  const cookie2 = await signIn(app, OTHER_GITHUB_ACCOUNT);

  // User 2 tries to switch to User 1's org via Better-Auth set-active
  const switchRes = await app.handle(
    new Request(`${BASE_URL}/api/auth/organization/set-active`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookie2 },
      body: JSON.stringify({ organizationId: org1.id }),
    }),
  );
  expect(switchRes.status).toBe(403);

  // User 2 tries to switch to User 1's org via /api/v1/workspaces/switch
  const v1SwitchRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/workspaces/switch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookie2 },
      body: JSON.stringify({ organizationId: org1.id }),
    }),
  );
  expect(v1SwitchRes.status).toBe(403);
});

test('creates a workspace with unique slug, free billing, and switches to it', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const user = await prisma.user.findFirstOrThrow();

  const createRes = await app.handle(
    new Request(`${BASE_URL}/api/auth/organization/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Acme Products' }),
    }),
  );
  expect(createRes.status).toBe(200);
  const created = (await createRes.json()) as { id: string; name: string; slug: string };
  expect(created.name).toBe('Acme Products');
  expect(created.slug).toMatch(/^acme-products-[a-z0-9]{6}$/);

  // Verify user is owner member
  const member = await prisma.member.findUniqueOrThrow({
    where: { organizationId_userId: { organizationId: created.id, userId: user.id } },
  });
  expect(member.role).toBe('owner');

  // Verify free WorkspaceBilling row created
  const billing = await prisma.workspaceBilling.findUniqueOrThrow({
    where: { organizationId: created.id },
  });
  expect(billing.plan).toBe('free');

  // Verify active organization automatically switched to new workspace
  const sessionRes = await app.handle(
    new Request(`${BASE_URL}/api/auth/get-session`, {
      headers: { cookie },
    }),
  );
  const session = await sessionRes.json();
  expect(session.session.activeOrganizationId).toBe(created.id);
});

test('enforces limit of 5 owned workspaces per user (422)', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const user = await prisma.user.findFirstOrThrow();

  // User already owns 1 personal org. Create 4 more to reach 5.
  for (let i = 2; i <= 5; i++) {
    const res = await app.handle(
      new Request(`${BASE_URL}/api/auth/organization/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ name: `Workspace ${i}` }),
      }),
    );
    expect(res.status).toBe(200);
  }

  expect(await prisma.member.count({ where: { userId: user.id, role: 'owner' } })).toBe(5);

  // 6th workspace attempt via Better-Auth should return 422
  const extraRes = await app.handle(
    new Request(`${BASE_URL}/api/auth/organization/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Workspace 6' }),
    }),
  );
  expect(extraRes.status).toBe(422);
  const extraBody = (await extraRes.json()) as { message?: string };
  expect(extraBody.message).toContain('Workspace limit reached');

  // 6th workspace attempt via /api/v1/workspaces should also return 422
  const extraV1Res = await app.handle(
    new Request(`${BASE_URL}/api/v1/workspaces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Workspace 6' }),
    }),
  );
  expect(extraV1Res.status).toBe(422);

  // Total owned should still be 5
  expect(await prisma.member.count({ where: { userId: user.id, role: 'owner' } })).toBe(5);
});

test('per-workspace state (plan, site, guides) stays isolated', async () => {
  const app = createApp(async () => {});
  const cookie = await signIn(app);
  const org1 = await prisma.organization.findFirstOrThrow();

  // Set org1 site title and create a guide in org1
  await prisma.workspaceSite.create({
    data: { organizationId: org1.id, siteTitle: 'Org 1 Docs' },
  });
  await prisma.flow.create({
    data: {
      publicId: 'flow-org-1',
      organizationId: org1.id,
      title: 'Guide for Org 1',
    },
  });

  // Verify org1 sees its site and guide
  const site1Res = await app.handle(
    new Request(`${BASE_URL}/api/v1/site`, {
      headers: { cookie },
    }),
  );
  const site1 = (await site1Res.json()) as { site_title: string };
  expect(site1.site_title).toBe('Org 1 Docs');

  const flows1Res = await app.handle(
    new Request(`${BASE_URL}/api/v1/flows`, {
      headers: { cookie },
    }),
  );
  const flows1 = (await flows1Res.json()) as { items: Array<{ title: string }> };
  expect(flows1.items).toHaveLength(1);
  expect(flows1.items[0]!.title).toBe('Guide for Org 1');

  // Create org2 and switch to it
  const createRes = await app.handle(
    new Request(`${BASE_URL}/api/auth/organization/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Org 2 Docs' }),
    }),
  );
  expect(createRes.status).toBe(200);

  // In org2, site should be org2 (lazy create or default) and flows should be empty
  const site2Res = await app.handle(
    new Request(`${BASE_URL}/api/v1/site`, {
      headers: { cookie },
    }),
  );
  const site2 = (await site2Res.json()) as { site_title: string };
  expect(site2.site_title).toBe('Org 2 Docs');

  const flows2Res = await app.handle(
    new Request(`${BASE_URL}/api/v1/flows`, {
      headers: { cookie },
    }),
  );
  const flows2 = (await flows2Res.json()) as { items: Array<{ title: string }> };
  expect(flows2.items).toHaveLength(0);

  // Switch back to org1
  await app.handle(
    new Request(`${BASE_URL}/api/auth/organization/set-active`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ organizationId: org1.id }),
    }),
  );

  // In org1, flows should still contain Guide for Org 1
  const flows1Back = await app.handle(
    new Request(`${BASE_URL}/api/v1/flows`, {
      headers: { cookie },
    }),
  );
  const flows1BackBody = (await flows1Back.json()) as { items: Array<{ title: string }> };
  expect(flows1BackBody.items).toHaveLength(1);
  expect(flows1BackBody.items[0]!.title).toBe('Guide for Org 1');
});
