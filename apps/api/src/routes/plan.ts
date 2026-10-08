import { DAILY_QUOTAS, type Plan } from '../legacy-limits';
import { Elysia } from 'elysia';
import { resolveOrganizationId } from '../auth-context';
import { getPrisma } from '../db';
import { capabilitiesFor, getPlan, type PlanCapabilities } from '../plan';

const startOfUtcDay = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

const PLANS: readonly Plan[] = ['free', 'pro', 'enterprise'];

type PlanEntry = {
  plan: Plan;
  quota: { files: number; bytes: number };
  capabilities: PlanCapabilities;
};

/** Side-by-side matrix for every plan (AC-15: "three plans side by side"), independent of the caller's own plan. */
const planMatrix = (): PlanEntry[] =>
  PLANS.map((plan) => ({ plan, quota: DAILY_QUOTAS[plan], capabilities: capabilitiesFor(plan) }));

export const planRoute = new Elysia().get('/api/v1/plan', async ({ request }) => {
  const organizationId = await resolveOrganizationId(request);

  const plan = await getPlan(organizationId);
  const quota = DAILY_QUOTAS[plan];

  const usage = await getPrisma().usageDaily.findUnique({
    where: { organizationId_day: { organizationId, day: startOfUtcDay(new Date()) } },
    select: { files: true, bytes: true },
  });

  return {
    plan,
    quota: {
      files_left: Math.max(0, quota.files - (usage?.files ?? 0)),
      bytes_left: Math.max(0, quota.bytes - Number(usage?.bytes ?? 0n)),
    },
    plans: planMatrix(),
  };
});
