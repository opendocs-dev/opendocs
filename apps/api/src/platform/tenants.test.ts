import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import {
  BASE_URL,
  cleanDatabase,
  GITHUB_ACCOUNT,
  realFetch,
  signIn,
  type App,
} from '../../test/helpers';
import { getPrisma } from '../db';
import { createApp } from '../index';
import { LocalDiskProvider } from '../storage/local';

const prisma = getPrisma();

const newApp = async (): Promise<App> => {
  const root = await mkdtemp(join(tmpdir(), 'od-tenants-test-'));
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
});

afterAll(async () => {
  await cleanDatabase();
});

test('GET /api/v1/platform/tenants returns 401 without session', async () => {
  const app = await newApp();
  const response = await app.handle(new Request(`${BASE_URL}/api/v1/platform/tenants`));
  expect(response.status).toBe(401);
});

test('GET /api/v1/platform/tenants returns 403 for non-staff user', async () => {
  const app = await newApp();
  const cookie = await signIn(app);

  const response = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/tenants`, { headers: { cookie } }),
  );
  expect(response.status).toBe(403);
});

test('GET /api/v1/platform/tenants returns list of tenants with plan, guides, storage, and status', async () => {
  const app = await newApp();
  const cookie = await signIn(app);

  // Set user as platform support
  await prisma.user.updateMany({
    where: { email: GITHUB_ACCOUNT.email! },
    data: { staffRole: 'support' },
  });

  // the signed-in user's personal workspace is also a tenant: start from a clean slate
  await prisma.organization.deleteMany();

  // Create test organizations
  const org1 = await prisma.organization.create({
    data: {
      id: 'org-acme',
      name: 'Acme Help',
      slug: 'acme',
      billing: {
        create: { plan: 'enterprise' },
      },
      flows: {
        create: [
          { publicId: 'flow-1', title: 'Guide 1' },
          { publicId: 'flow-2', title: 'Guide 2' },
        ],
      },
      assets: {
        create: [
          {
            publicId: 'asset-1',
            kind: 'step',
            provider: 'local',
            providerAccount: 'local',
            providerFileId: 'f1',
            mime: 'image/png',
            bytes: 1048576,
            width: 100,
            height: 100,
            sha256: 'abc1',
          },
        ],
      },
    },
  });

  const org2 = await prisma.organization.create({
    data: {
      id: 'org-spamly',
      name: 'Spamly',
      slug: 'spamly',
      suspendedAt: new Date(),
    },
  });

  const response = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/tenants`, { headers: { cookie } }),
  );
  expect(response.status).toBe(200);

  const data = (await response.json()) as {
    tenants: Array<{
      id: string;
      name: string;
      slug: string;
      plan: string;
      guides_count: number;
      storage_bytes: number;
      status: string;
    }>;
    total: number;
  };

  expect(data.total).toBe(2);
  const pfn = data.tenants.find((t) => t.slug === 'acme')!;
  expect(pfn).toBeDefined();
  expect(pfn.name).toBe('Acme Help');
  expect(pfn.plan).toBe('enterprise');
  expect(pfn.guides_count).toBe(2);
  expect(pfn.storage_bytes).toBe(1048576);
  expect(pfn.status).toBe('active');

  const spam = data.tenants.find((t) => t.slug === 'spamly')!;
  expect(spam).toBeDefined();
  expect(spam.plan).toBe('free');
  expect(spam.status).toBe('suspended');
});

test('GET /api/v1/platform/tenants filters by search query and plan', async () => {
  const app = await newApp();
  const cookie = await signIn(app);

  await prisma.user.updateMany({
    where: { email: GITHUB_ACCOUNT.email! },
    data: { staffRole: 'admin' },
  });

  await prisma.organization.deleteMany();

  await prisma.organization.create({
    data: {
      id: 'org-northwind',
      name: 'Northwind Docs',
      slug: 'northwind',
      billing: { create: { plan: 'pro' } },
    },
  });

  await prisma.organization.create({
    data: {
      id: 'org-acme',
      name: 'Acme Telco',
      slug: 'acme',
      billing: { create: { plan: 'pro' } },
    },
  });

  await prisma.organization.create({
    data: {
      id: 'org-beta',
      name: 'Beta Studio',
      slug: 'beta',
    },
  });

  // Filter by q=north
  const searchRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/tenants?q=north`, { headers: { cookie } }),
  );
  expect(searchRes.status).toBe(200);
  const searchData = (await searchRes.json()) as { tenants: Array<{ slug: string }>; total: number };
  expect(searchData.total).toBe(1);
  expect(searchData.tenants[0].slug).toBe('northwind');

  // Filter by plan=pro
  const proRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/tenants?plan=pro`, { headers: { cookie } }),
  );
  expect(proRes.status).toBe(200);
  const proData = (await proRes.json()) as { tenants: Array<{ slug: string }>; total: number };
  expect(proData.total).toBe(2);

  // Filter by plan=free
  const freeRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/tenants?plan=free`, { headers: { cookie } }),
  );
  expect(freeRes.status).toBe(200);
  const freeData = (await freeRes.json()) as { tenants: Array<{ slug: string }>; total: number };
  expect(freeData.total).toBe(1);
  expect(freeData.tenants[0].slug).toBe('beta');
});

test('GET /api/v1/platform/tenants/:slug returns tenant details', async () => {
  const app = await newApp();
  const cookie = await signIn(app);

  await prisma.user.updateMany({
    where: { email: GITHUB_ACCOUNT.email! },
    data: { staffRole: 'support' },
  });

  // the signed-in user's personal workspace is also a tenant: start from a clean slate
  await prisma.organization.deleteMany();

  const org = await prisma.organization.create({
    data: {
      id: 'org-detail',
      name: 'Detail Org',
      slug: 'detail-org',
      billing: { create: { plan: 'pro' } },
      site: {
        create: {
          siteTitle: 'Detail Site',
          customDomain: 'docs.detail.com',
          domainStatus: 'verified',
        },
      },
    },
  });

  // Non-existent tenant returns 404
  const notFoundRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/tenants/nonexistent`, { headers: { cookie } }),
  );
  expect(notFoundRes.status).toBe(404);

  // Existing tenant returns details
  const res = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/tenants/detail-org`, { headers: { cookie } }),
  );
  expect(res.status).toBe(200);
  const data = (await res.json()) as {
    tenant: {
      name: string;
      slug: string;
      plan: string;
      domain: { custom_domain: string | null; domain_status: string | null };
      ai_credits: { balance: number; monthly_limit: number };
      audit_logs: unknown[];
    };
  };

  expect(data.tenant.name).toBe('Detail Org');
  expect(data.tenant.plan).toBe('pro');
  expect(data.tenant.domain.custom_domain).toBe('docs.detail.com');
  expect(data.tenant.domain.domain_status).toBe('verified');
  expect(data.tenant.ai_credits.monthly_limit).toBe(2500);
});

test('mutations: support role cannot change plan, suspend, or grant credits (403)', async () => {
  const app = await newApp();
  const cookie = await signIn(app);

  await prisma.user.updateMany({
    where: { email: GITHUB_ACCOUNT.email! },
    data: { staffRole: 'support' },
  });

  await prisma.organization.create({
    data: { id: 'org-test', name: 'Test Org', slug: 'test-org' },
  });

  // Change plan
  const planRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/tenants/test-org/plan`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'enterprise', reason: 'Customer upgraded contract' }),
    }),
  );
  expect(planRes.status).toBe(403);

  // Suspend
  const suspendRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/tenants/test-org/suspend`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'suspend', reason: 'Abuse report' }),
    }),
  );
  expect(suspendRes.status).toBe(403);

  // Grant credits
  const creditsRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/tenants/test-org/credits`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ credits: 500, reason: 'Promotional gift' }),
    }),
  );
  expect(creditsRes.status).toBe(403);
});

test('platform admin can change plan with reason and audit log is written', async () => {
  const app = await newApp();
  const cookie = await signIn(app);

  await prisma.user.updateMany({
    where: { email: GITHUB_ACCOUNT.email! },
    data: { staffRole: 'admin' },
  });

  await prisma.organization.create({
    data: { id: 'org-plan-test', name: 'Plan Org', slug: 'plan-org' },
  });

  // Missing reason fails with 422
  const noReasonRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/tenants/plan-org/plan`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'enterprise' }),
    }),
  );
  expect(noReasonRes.status).toBe(422);

  // Success
  const res = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/tenants/plan-org/plan`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'enterprise', reason: 'Custom deal approved' }),
    }),
  );
  expect(res.status).toBe(200);

  const billing = await prisma.workspaceBilling.findUnique({
    where: { organizationId: 'org-plan-test' },
  });
  expect(billing?.plan).toBe('enterprise');

  const auditLog = await prisma.auditLog.findFirst({
    where: { organizationId: 'org-plan-test' },
    orderBy: { createdAt: 'desc' },
  });
  expect(auditLog).toBeDefined();
  expect(auditLog?.actorKind).toBe('staff');
  expect(auditLog?.action).toContain('Staff changed plan');
  expect((auditLog?.detail as { reason: string }).reason).toBe('Custom deal approved');
});

test('platform admin can suspend and restore tenant, affecting public site availability', async () => {
  const app = await newApp();
  const cookie = await signIn(app);

  await prisma.user.updateMany({
    where: { email: GITHUB_ACCOUNT.email! },
    data: { staffRole: 'admin' },
  });

  await prisma.organization.create({
    data: {
      id: 'org-suspend-test',
      name: 'Suspend Org',
      slug: 'suspend-org',
      flows: {
        create: [
          {
            publicId: 'flow-pub-1',
            title: 'Public Guide',
            visibility: 'published',
            latestRunId: 'run-1',
          },
        ],
      },
    },
  });

  // Verify public site is reachable initially
  const publicBefore = await app.handle(
    new Request(`${BASE_URL}/api/v1/site/suspend-org/categories`),
  );
  expect(publicBefore.status).toBe(200);

  // Suspend without reason fails with 422
  const noReasonSuspend = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/tenants/suspend-org/suspend`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'suspend' }),
    }),
  );
  expect(noReasonSuspend.status).toBe(422);

  // Suspend with reason
  const suspendRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/tenants/suspend-org/suspend`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'suspend', reason: 'TOS violation' }),
    }),
  );
  expect(suspendRes.status).toBe(200);

  const orgAfterSuspend = await prisma.organization.findUnique({
    where: { id: 'org-suspend-test' },
  });
  expect(orgAfterSuspend?.suspendedAt).not.toBeNull();

  // Public site must now return 404 Not Found!
  const publicDuringSuspend = await app.handle(
    new Request(`${BASE_URL}/api/v1/site/suspend-org/categories`),
  );
  expect(publicDuringSuspend.status).toBe(404);

  // Restore site
  const restoreRes = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/tenants/suspend-org/suspend`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'restore', reason: 'Issue resolved' }),
    }),
  );
  expect(restoreRes.status).toBe(200);

  const orgAfterRestore = await prisma.organization.findUnique({
    where: { id: 'org-suspend-test' },
  });
  expect(orgAfterRestore?.suspendedAt).toBeNull();

  // Public site is accessible again
  const publicAfterRestore = await app.handle(
    new Request(`${BASE_URL}/api/v1/site/suspend-org/categories`),
  );
  expect(publicAfterRestore.status).toBe(200);
});

test('platform admin can grant AI credits with reason and ledger row is created', async () => {
  const app = await newApp();
  const cookie = await signIn(app);

  await prisma.user.updateMany({
    where: { email: GITHUB_ACCOUNT.email! },
    data: { staffRole: 'admin' },
  });

  await prisma.organization.create({
    data: { id: 'org-credits-test', name: 'Credits Org', slug: 'credits-org' },
  });

  // Invalid credits fails with 422
  const invalidCredits = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/tenants/credits-org/credits`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ credits: -10, reason: 'Negative' }),
    }),
  );
  expect(invalidCredits.status).toBe(422);

  // Missing reason fails with 422
  const noReason = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/tenants/credits-org/credits`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ credits: 500 }),
    }),
  );
  expect(noReason.status).toBe(422);

  // Valid grant
  const res = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/tenants/credits-org/credits`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ credits: 1000, reason: 'Enterprise bonus' }),
    }),
  );
  expect(res.status).toBe(200);
  const data = (await res.json()) as { ok: boolean; balance: number; granted: number };
  expect(data.ok).toBe(true);
  expect(data.balance).toBe(1000);
  expect(data.granted).toBe(1000);

  const ledgerRow = await prisma.aiCreditLedger.findFirst({
    where: { organizationId: 'org-credits-test' },
  });
  expect(ledgerRow).toBeDefined();
  expect(ledgerRow?.delta).toBe(1000);
  expect(ledgerRow?.reason).toBe('admin_grant');
  expect(ledgerRow?.balanceAfter).toBe(1000);

  // Grant additional credits updates balance
  const res2 = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/tenants/credits-org/credits`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ credits: 500, reason: 'Second grant' }),
    }),
  );
  expect(res2.status).toBe(200);
  const data2 = (await res2.json()) as { ok: boolean; balance: number };
  expect(data2.balance).toBe(1500);
});
