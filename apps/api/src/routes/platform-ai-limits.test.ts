import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { BASE_URL, cleanDatabase, GITHUB_ACCOUNT, OTHER_GITHUB_ACCOUNT, realFetch, signIn, type App } from '../../test/helpers';
import { getPrisma } from '../db';
import { createApp } from '../index';
import { resetMonthlyAiCredits } from '../jobs/ai-credits-reset';

const prisma = getPrisma();

const newApp = (): App => createApp(async () => {});

const withAdminEnv = async (fn: () => Promise<void>) => {
  const previous = process.env.PLATFORM_ADMIN_EMAILS;
  process.env.PLATFORM_ADMIN_EMAILS = GITHUB_ACCOUNT.email ?? '';
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
    else process.env.PLATFORM_ADMIN_EMAILS = previous;
  }
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

test('non-staff users receive 403 on settings, plans and limits routes', async () => {
  const app = newApp();
  process.env.PLATFORM_ADMIN_EMAILS = GITHUB_ACCOUNT.email ?? '';
  const cookie = await signIn(app, OTHER_GITHUB_ACCOUNT);

  // Settings
  const resSettings = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/ai/settings`, { headers: { cookie } }),
  );
  expect(resSettings.status).toBe(403);

  // Plans
  const resPlans = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/ai/plans`, { headers: { cookie } }),
  );
  expect(resPlans.status).toBe(403);

  // Tenant credit grant
  const resGrant = await app.handle(
    new Request(`${BASE_URL}/api/v1/platform/ai/tenants/nonexistent/credits`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ credits: 100, reason: 'test' }),
    }),
  );
  expect(resGrant.status).toBe(403);
});

test('emergency kill switch and settings updates persist properly', () =>
  withAdminEnv(async () => {
    const app = newApp();
    const cookie = await signIn(app, GITHUB_ACCOUNT);

    // Initial settings: aiEnabled is true
    const resGet = await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/ai/settings`, { headers: { cookie } }),
    );
    expect(resGet.status).toBe(200);
    const initial = (await resGet.json()) as { aiEnabled: boolean };
    expect(initial.aiEnabled).toBe(true);

    // Update settings: kill switch, spend cap, alert percent, overage action, charge delivered flag
    const resPatch = await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/ai/settings`, {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          aiEnabled: false,
          spendCapMonthly: 750,
          alertPercent: 90,
          pauseAtCap: true,
          creditOverageAction: 'add_credits',
          chargeOnlyWhenDelivered: true,
        }),
      }),
    );
    expect(resPatch.status).toBe(200);
    const patched = (await resPatch.json()) as {
      aiEnabled: boolean;
      spendCapMonthly: number;
      alertPercent: number;
      creditOverageAction: string;
      chargeOnlyWhenDelivered: boolean;
    };
    expect(patched.aiEnabled).toBe(false);
    expect(patched.spendCapMonthly).toBe(750);
    expect(patched.alertPercent).toBe(90);
    expect(patched.creditOverageAction).toBe('add_credits');
    expect(patched.chargeOnlyWhenDelivered).toBe(true);

    // Verify in database
    const dbSettings = await prisma.aiPlatformSettings.findUniqueOrThrow({ where: { id: 'global' } });
    expect(dbSettings.aiEnabled).toBe(false);
    expect(dbSettings.spendCapMonthly).toBe(750);
    expect(dbSettings.creditOverageAction).toBe('add_credits');

    // Reset kill switch
    await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/ai/settings`, {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ aiEnabled: true }),
      }),
    );
  }));

test('staff can view and update plan quotas and BYOK permissions', () =>
  withAdminEnv(async () => {
    const app = newApp();
    const cookie = await signIn(app, GITHUB_ACCOUNT);

    // GET plans
    const getRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/ai/plans`, { headers: { cookie } }),
    );
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as { plans: Array<{ plan: string; monthlyCredits: number; byokAllowed: boolean }> };
    expect(getBody.plans.length).toBeGreaterThanOrEqual(3);

    // Update Pro plan to 2000 credits and BYOK allowed
    const patchRes = await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/ai/plans/pro`, {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ monthlyCredits: 2000, byokAllowed: true }),
      }),
    );
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { plan: string; monthlyCredits: number; byokAllowed: boolean };
    expect(patched.monthlyCredits).toBe(2000);
    expect(patched.byokAllowed).toBe(true);

    // Verify in database
    const dbPro = await prisma.planConfig.findUniqueOrThrow({ where: { plan: 'pro' } });
    expect(dbPro.monthlyCredits).toBe(2000);
    expect(dbPro.byokAllowed).toBe(true);
  }));

test('manual grant increments balance and logs audit trail with tenant isolation', () =>
  withAdminEnv(async () => {
    const app = newApp();
    const cookie = await signIn(app, GITHUB_ACCOUNT);

    const orgA = await prisma.organization.create({
      data: { id: 'tenant-a-limits-test', name: 'Tenant A', slug: 'tenant-a-limits' },
    });
    const orgB = await prisma.organization.create({
      data: { id: 'tenant-b-limits-test', name: 'Tenant B', slug: 'tenant-b-limits' },
    });

    // Grant 500 credits to Tenant A
    const resGrant1 = await app.handle(
      new Request(`${BASE_URL}/api/v1/platform/ai/tenants/${orgA.id}/credits`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ credits: 500, reason: 'Promotional credit grant' }),
      }),
    );
    expect(resGrant1.status).toBe(200);
    const body1 = (await resGrant1.json()) as { ok: boolean; balanceAfter: number; delta: number };
    expect(body1.ok).toBe(true);
    expect(body1.delta).toBe(500);
    expect(body1.balanceAfter).toBe(500);

    // Verify Tenant B remains isolated
    const ledgerB = await prisma.aiCreditLedger.findMany({ where: { organizationId: orgB.id } });
    expect(ledgerB.length).toBe(0);
  }));

test('monthly cron resets tenant credits to plan quota from PlanConfig and prevents double grant on retry', async () => {
  await prisma.planConfig.upsert({
    where: { plan: 'pro' },
    create: { plan: 'pro', monthlyCredits: 1000, byokAllowed: false },
    update: { monthlyCredits: 1000 },
  });
  await prisma.planConfig.upsert({
    where: { plan: 'enterprise' },
    create: { plan: 'enterprise', monthlyCredits: 10000, byokAllowed: true },
    update: { monthlyCredits: 10000 },
  });
  await prisma.planConfig.upsert({
    where: { plan: 'free' },
    create: { plan: 'free', monthlyCredits: 0, byokAllowed: false },
    update: { monthlyCredits: 0 },
  });

  const orgFree = await prisma.organization.create({
    data: { id: 'org-free-cron', name: 'Free Org', slug: 'org-free-cron' },
  });
  const orgPro = await prisma.organization.create({
    data: {
      id: 'org-pro-cron',
      name: 'Pro Org',
      slug: 'org-pro-cron',
      billing: { create: { plan: 'pro' } },
    },
  });

  const testMonth = new Date('2026-10-01T00:00:00Z');

  // First run
  const result1 = await resetMonthlyAiCredits(testMonth);
  expect(result1.locked).toBe(true);
  expect(result1.resetCount).toBeGreaterThanOrEqual(1);

  // Check Pro balance
  const ledgerPro = await prisma.aiCreditLedger.findFirstOrThrow({
    where: { organizationId: orgPro.id, reason: 'monthly_reset' },
  });
  expect(ledgerPro.credits).toBe(1000);
  expect(ledgerPro.balanceAfter).toBe(1000);

  // Check Free: 0 credits granted
  const ledgerFree = await prisma.aiCreditLedger.findMany({
    where: { organizationId: orgFree.id },
  });
  expect(ledgerFree.length).toBe(0);

  // Second run on the same month (Retry scenario): must NOT double grant!
  const result2 = await resetMonthlyAiCredits(testMonth);
  expect(result2.locked).toBe(true);
  expect(result2.resetCount).toBe(0);
});
