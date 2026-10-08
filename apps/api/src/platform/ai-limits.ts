import { Elysia } from 'elysia';
import { ApiError } from '../errors';
import { getPrisma } from '../db';
import { requirePlatformAdmin, requirePlatformStaff } from '../platform-guard';
import { resetMonthlyAiCredits } from '../jobs/ai-credits-reset';

const readJsonBody = async (request: Request): Promise<Record<string, unknown>> => {
  const text = await request.text().catch(() => {
    throw new ApiError(422, 'validation_failed', 'A JSON request body is required');
  });

  let parsed: unknown = {};
  if (text.trim().length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ApiError(422, 'validation_failed', 'Request body must be valid JSON');
    }
  }

  return (parsed as Record<string, unknown>) ?? {};
};

export const getPlatformAiSettings = async () => {
  const prisma = getPrisma();
  let settings = await prisma.aiPlatformSettings.findUnique({ where: { id: 'global' } });
  if (!settings) {
    settings = await prisma.aiPlatformSettings.create({
      data: {
        id: 'global',
        aiEnabled: true,
        spendCapMonthly: 500.0,
        currentMonthSpend: 0.0,
        alertPercent: 80,
        pauseAtCap: true,
        creditOverageAction: 'stop',
        chargeOnlyWhenDelivered: true,
      },
    });
  }
  return settings;
};

export const updatePlatformAiSettings = async (body: Record<string, unknown>) => {
  const data: Record<string, unknown> = {};

  if (typeof body.aiEnabled === 'boolean') data.aiEnabled = body.aiEnabled;
  if (typeof body.spendCapMonthly === 'number') data.spendCapMonthly = Math.max(0, body.spendCapMonthly);
  if (typeof body.currentMonthSpend === 'number') data.currentMonthSpend = Math.max(0, body.currentMonthSpend);
  if (typeof body.alertPercent === 'number') data.alertPercent = Math.min(100, Math.max(0, Math.floor(body.alertPercent)));
  if (typeof body.pauseAtCap === 'boolean') data.pauseAtCap = body.pauseAtCap;
  if (typeof body.creditOverageAction === 'string') data.creditOverageAction = body.creditOverageAction;
  if (typeof body.chargeOnlyWhenDelivered === 'boolean') data.chargeOnlyWhenDelivered = body.chargeOnlyWhenDelivered;

  const prisma = getPrisma();
  return prisma.aiPlatformSettings.upsert({
    where: { id: 'global' },
    create: {
      id: 'global',
      aiEnabled: typeof body.aiEnabled === 'boolean' ? body.aiEnabled : true,
      spendCapMonthly: typeof body.spendCapMonthly === 'number' ? body.spendCapMonthly : 500.0,
      currentMonthSpend: typeof body.currentMonthSpend === 'number' ? body.currentMonthSpend : 0.0,
      alertPercent: typeof body.alertPercent === 'number' ? Math.floor(body.alertPercent) : 80,
      pauseAtCap: typeof body.pauseAtCap === 'boolean' ? body.pauseAtCap : true,
      creditOverageAction: typeof body.creditOverageAction === 'string' ? body.creditOverageAction : 'stop',
      chargeOnlyWhenDelivered: typeof body.chargeOnlyWhenDelivered === 'boolean' ? body.chargeOnlyWhenDelivered : true,
    },
    update: data,
  });
};

export const grantTenantCredits = async (
  targetId: string,
  credits: number,
  reason: string,
) => {
  if (credits === 0) throw new ApiError(422, 'validation_failed', 'credits must be a non-zero number');
  if (!reason.trim()) throw new ApiError(422, 'validation_failed', 'reason is required');

  const prisma = getPrisma();
  const org = await prisma.organization.findFirst({
    where: {
      OR: [{ id: targetId }, { slug: targetId }],
    },
  });

  if (!org) throw new ApiError(404, 'not_found', `Tenant "${targetId}" not found`);

  return prisma.$transaction(async (tx) => {
    // Row-level lock on the Organization row to serialize balance calculation per tenant
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${org.id} FOR UPDATE`;

    const latest = await tx.aiCreditLedger.findFirst({
      where: { organizationId: org.id },
      orderBy: { createdAt: 'desc' },
    });

    const currentBalance = latest?.balanceAfter ?? 0;
    const newBalance = currentBalance + credits;

    const randomSuffix = Math.random().toString(36).slice(2, 8);
    const messageId = `grant-${Date.now()}-${randomSuffix}`;

    await tx.aiCreditLedger.create({
      data: {
        organizationId: org.id,
        delta: credits,
        reason: 'admin_grant',
        messageId,
        credits,
        balanceAfter: newBalance,
      },
    });

    return {
      ok: true,
      organizationId: org.id,
      delta: credits,
      balanceAfter: newBalance,
      reason,
    };
  });
};

const ensureDefaultPlans = async () => {
  const prisma = getPrisma();
  const count = await prisma.planConfig.count();
  if (count === 0) {
    await prisma.planConfig.createMany({
      data: [
        { plan: 'free', monthlyCredits: 0, byokAllowed: false },
        { plan: 'pro', monthlyCredits: 1000, byokAllowed: false },
        { plan: 'enterprise', monthlyCredits: 10000, byokAllowed: true },
      ],
    });
  }
};

// Route Handlers
const handleGetSettings = async ({ request }: { request: Request }) => {
  await requirePlatformStaff(request);
  return getPlatformAiSettings();
};

const handlePatchSettings = async ({ request }: { request: Request }) => {
  await requirePlatformAdmin(request);
  const body = await readJsonBody(request);
  return updatePlatformAiSettings(body);
};

const handleGetPlans = async ({ request }: { request: Request }) => {
  await requirePlatformStaff(request);
  const prisma = getPrisma();
  await ensureDefaultPlans();
  const plans = await prisma.planConfig.findMany({ orderBy: { plan: 'asc' } });
  return { plans };
};

const handlePatchPlan = async ({
  request,
  params,
}: {
  request: Request;
  params: { plan: string };
}) => {
  await requirePlatformAdmin(request);
  const body = await readJsonBody(request);
  const planName = params.plan.toLowerCase();
  const prisma = getPrisma();

  const existing = await prisma.planConfig.findUnique({ where: { plan: planName } });
  if (!existing) throw new ApiError(404, 'not_found', `Plan "${params.plan}" not found`);

  const data: Record<string, unknown> = {};
  if (typeof body.monthlyCredits === 'number') data.monthlyCredits = Math.max(0, Math.floor(body.monthlyCredits));
  if (typeof body.byokAllowed === 'boolean') data.byokAllowed = body.byokAllowed;

  return prisma.planConfig.update({
    where: { plan: planName },
    data,
  });
};

const handleGrantCredits = async ({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}) => {
  await requirePlatformAdmin(request);
  const body = await readJsonBody(request);
  const credits = typeof body.credits === 'number' ? Math.floor(body.credits) : 0;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  return grantTenantCredits(params.id, credits, reason);
};

const handleResetCredits = async ({ request }: { request: Request }) => {
  await requirePlatformAdmin(request);
  return resetMonthlyAiCredits();
};

export const platformAiLimitsRoute = new Elysia()
  // Global settings
  .get('/api/v1/platform/ai/settings', handleGetSettings)
  .patch('/api/v1/platform/ai/settings', handlePatchSettings)

  // Plans config
  .get('/api/v1/platform/ai/plans', handleGetPlans)
  .patch('/api/v1/platform/ai/plans/:plan', handlePatchPlan)

  // Manual Credit Grant
  .post('/api/v1/platform/ai/tenants/:id/credits', handleGrantCredits)

  // Trigger monthly credit reset
  .post('/api/v1/platform/ai/reset-credits', handleResetCredits);
