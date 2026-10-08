import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { BASE_URL, cleanDatabase, GITHUB_ACCOUNT, OTHER_GITHUB_ACCOUNT, realFetch, signIn, type App } from '../../test/helpers';
import { getPrisma } from '../db';
import { createApp } from '../index';
import { LocalDiskProvider } from '../storage/local';
import { migratePlatformAdminsFromEnv, verifyPlatformAdminMigration } from '../platform-guard';

const prisma = getPrisma();

const newApp = async (): Promise<App> => {
  const root = await mkdtemp(join(tmpdir(), 'od-staff-test-'));
  return createApp(async () => {}, {
    provider: new LocalDiskProvider(root),
    accounts: ['local'],
  });
};

beforeEach(async () => {
  await cleanDatabase();
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete process.env.PLATFORM_ADMIN_EMAILS;
  delete process.env.PLATFORM_ADMIN_FALLBACK_DISABLED;
});

afterAll(async () => {
  await cleanDatabase();
});

test('GET /api/v1/platform/staff returns 401 without session', async () => {
  const app = await newApp();
  const response = await app.handle(new Request(`${BASE_URL}/api/v1/platform/staff`));
  expect(response.status).toBe(401);
});

test('GET /api/v1/platform/staff returns 403 for non-staff user', async () => {
  const app = await newApp();
  const cookie = await signIn(app);

  const response = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/staff`, { headers: { cookie } }),
  );
  expect(response.status).toBe(403);
});

test('platform support can view staff list and audit log, but cannot add staff', async () => {
  const app = await newApp();
  const cookie = await signIn(app);

  // Set user as support
  await prisma.user.updateMany({
    where: { email: GITHUB_ACCOUNT.email! },
    data: { staffRole: 'support' },
  });

  // GET /staff succeeds
  const getStaffRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/staff`, { headers: { cookie } }),
  );
  expect(getStaffRes.status).toBe(200);
  const staffBody = (await getStaffRes.json()) as { staff: Array<{ role: string; email: string }> };
  expect(staffBody.staff.length).toBe(1);
  expect(staffBody.staff[0].role).toBe('support');

  // GET /audit-log succeeds
  const getAuditRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/audit-log`, { headers: { cookie } }),
  );
  expect(getAuditRes.status).toBe(200);

  // POST /staff fails with 403 for support
  const postStaffRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/staff`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.com', role: 'admin' }),
    }),
  );
  expect(postStaffRes.status).toBe(403);
});

test('platform admin can add, update role, and remove staff with audit logging', async () => {
  const app = await newApp();
  const adminCookie = await signIn(app);

  // Promote signed-in user to admin
  const adminUser = await prisma.user.findFirstOrThrow({ where: { email: GITHUB_ACCOUNT.email! } });
  await prisma.user.update({
    where: { id: adminUser.id },
    data: { staffRole: 'admin' },
  });

  // Create another user account to add as staff
  const otherUser = await prisma.user.create({
    data: {
      id: 'other-user-uuid',
      name: 'Other Person',
      email: 'other@example.com',
    },
  });

  // 1. Add staff
  const addRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/staff`, {
      method: 'POST',
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ email: otherUser.email, role: 'support' }),
    }),
  );
  expect(addRes.status).toBe(201);
  const addBody = (await addRes.json()) as { staff: { role: string; email: string } };
  expect(addBody.staff.role).toBe('support');

  // Verify staff role in DB
  const updatedOther = await prisma.user.findUnique({ where: { id: otherUser.id } });
  expect(updatedOther?.staffRole).toBe('support');

  // Verify audit log created
  const logsAfterAdd = await prisma.auditLog.findMany({
    where: { actorKind: 'staff' },
  });
  expect(logsAfterAdd.length).toBeGreaterThan(0);
  expect(logsAfterAdd[0].action).toContain('Added staff');

  // 2. Update role to admin
  const patchRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/staff/${otherUser.id}`, {
      method: 'PATCH',
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    }),
  );
  expect(patchRes.status).toBe(200);

  const updatedToAdmin = await prisma.user.findUnique({ where: { id: otherUser.id } });
  expect(updatedToAdmin?.staffRole).toBe('admin');

  // 3. Remove staff
  const deleteRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/staff/${otherUser.id}`, {
      method: 'DELETE',
      headers: { cookie: adminCookie },
    }),
  );
  expect(deleteRes.status).toBe(200);

  const removed = await prisma.user.findUnique({ where: { id: otherUser.id } });
  expect(removed?.staffRole).toBeNull();
});

test('cannot demote or remove the only platform admin', async () => {
  const app = await newApp();
  const cookie = await signIn(app);

  const adminUser = await prisma.user.findFirstOrThrow({ where: { email: GITHUB_ACCOUNT.email! } });
  await prisma.user.update({
    where: { id: adminUser.id },
    data: { staffRole: 'admin' },
  });

  // Try to demote self
  const demoteRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/staff/${adminUser.id}`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'support' }),
    }),
  );
  expect(demoteRes.status).toBe(422);

  // Try to delete self
  const deleteRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/staff/${adminUser.id}`, {
      method: 'DELETE',
      headers: { cookie },
    }),
  );
  expect(deleteRes.status).toBe(422);
});

test('auto-migrates user from PLATFORM_ADMIN_EMAILS without losing access', async () => {
  const app = await newApp();
  const cookie = await signIn(app);

  // User has no staffRole in DB
  const userBefore = await prisma.user.findFirstOrThrow({ where: { email: GITHUB_ACCOUNT.email! } });
  expect(userBefore.staffRole).toBeNull();

  // Set legacy env var
  process.env.PLATFORM_ADMIN_EMAILS = GITHUB_ACCOUNT.email!;

  // Access platform route
  const res = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/staff`, { headers: { cookie } }),
  );
  expect(res.status).toBe(200);

  // Verify user was promoted to 'admin' in database
  const userAfter = await prisma.user.findFirstOrThrow({ where: { email: GITHUB_ACCOUNT.email! } });
  expect(userAfter.staffRole).toBe('admin');
});

test('migratePlatformAdminsFromEnv backfills all users listed in env', async () => {
  const user1 = await prisma.user.create({
    data: { id: 'u1', name: 'Admin 1', email: 'admin1@example.com' },
  });
  const user2 = await prisma.user.create({
    data: { id: 'u2', name: 'Admin 2', email: 'admin2@example.com' },
  });

  process.env.PLATFORM_ADMIN_EMAILS = 'admin1@example.com, admin2@example.com';

  const count = await migratePlatformAdminsFromEnv();
  expect(count).toBe(2);

  const u1 = await prisma.user.findUnique({ where: { id: user1.id } });
  const u2 = await prisma.user.findUnique({ where: { id: user2.id } });
  expect(u1?.staffRole).toBe('admin');
  expect(u2?.staffRole).toBe('admin');
});

test('audit log cannot be modified or deleted via API (immutability)', async () => {
  const app = await newApp();
  const cookie = await signIn(app);

  await prisma.user.updateMany({
    where: { email: GITHUB_ACCOUNT.email! },
    data: { staffRole: 'admin' },
  });

  // POST /api/v1/platform/audit-log should not exist
  const postRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/audit-log`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'fake' }),
    }),
  );
  expect(postRes.status).toBeGreaterThanOrEqual(404);

  // DELETE /api/v1/platform/audit-log should not exist
  const deleteRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/audit-log/some-id`, {
      method: 'DELETE',
      headers: { cookie },
    }),
  );
  expect(deleteRes.status).toBeGreaterThanOrEqual(404);

  // PUT /api/v1/platform/audit-log should not exist
  const putRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/audit-log/some-id`, {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'hacked' }),
    }),
  );
  expect(putRes.status).toBeGreaterThanOrEqual(404);
});
test('verifyPlatformAdminMigration reports pending and verified statuses', async () => {
  const user = await prisma.user.create({
    data: { id: 'u_pending', name: 'Pending Admin', email: 'pending-admin@example.com' },
  });

  process.env.PLATFORM_ADMIN_EMAILS = 'pending-admin@example.com';

  const before = await verifyPlatformAdminMigration();
  expect(before.verified).toBe(false);
  expect(before.pendingCount).toBe(1);
  expect(before.pendingEmails).toEqual(['pending-admin@example.com']);

  // Migrate
  await migratePlatformAdminsFromEnv();

  const after = await verifyPlatformAdminMigration();
  expect(after.verified).toBe(true);
  expect(after.pendingCount).toBe(0);
  expect(after.pendingEmails).toEqual([]);
});

test('PLATFORM_ADMIN_FALLBACK_DISABLED=true halts auto-promotion', async () => {
  const app = await newApp();
  const cookie = await signIn(app);

  process.env.PLATFORM_ADMIN_EMAILS = GITHUB_ACCOUNT.email!;
  process.env.PLATFORM_ADMIN_FALLBACK_DISABLED = 'true';

  const res = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/staff`, { headers: { cookie } }),
  );
  expect(res.status).toBe(403);

  // User was NOT promoted in DB
  const user = await prisma.user.findFirstOrThrow({ where: { email: GITHUB_ACCOUNT.email! } });
  expect(user.staffRole).toBeNull();
});
