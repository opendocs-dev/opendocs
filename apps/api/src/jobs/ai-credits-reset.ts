import { getPrisma } from '../db';

const AI_RESET_LOCK_ID = 842_331_010;

export type ResetResult = {
  locked: boolean;
  period: string;
  resetCount: number;
  skippedCount: number;
};

export const resetMonthlyAiCredits = async (
  referenceDate: Date = new Date(),
): Promise<ResetResult> => {
  const prisma = getPrisma();
  const year = referenceDate.getUTCFullYear();
  const month = String(referenceDate.getUTCMonth() + 1).padStart(2, '0');
  const period = `${year}-${month}`;
  const messageId = `monthly-${period}`;

  return prisma.$transaction(async (tx) => {
    const lockRows = await tx.$queryRaw<{ pg_try_advisory_xact_lock: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(${AI_RESET_LOCK_ID})
    `;
    if (!lockRows[0]?.pg_try_advisory_xact_lock) {
      return { locked: false, period, resetCount: 0, skippedCount: 0 };
    }

    const planConfigs = await tx.planConfig.findMany();
    const quotaByPlan = new Map<string, number>();
    for (const pc of planConfigs) {
      quotaByPlan.set(pc.plan.toLowerCase(), pc.monthlyCredits);
    }

    const organizations = await tx.organization.findMany({
      select: {
        id: true,
        billing: { select: { plan: true } },
      },
    });

    let resetCount = 0;
    let skippedCount = 0;

    for (const org of organizations) {
      const plan = (org.billing?.plan ?? 'free').toLowerCase();
      const quota = quotaByPlan.get(plan) ?? (plan === 'pro' ? 1000 : plan === 'enterprise' ? 10000 : 0);

      if (quota <= 0) {
        skippedCount++;
        continue;
      }

      const existing = await tx.aiCreditLedger.findUnique({
        where: {
          organizationId_messageId_reason: {
            organizationId: org.id,
            messageId,
            reason: 'monthly_reset',
          },
        },
      });

      if (existing) {
        skippedCount++;
        continue;
      }

      const latest = await tx.aiCreditLedger.findFirst({
        where: { organizationId: org.id },
        orderBy: { createdAt: 'desc' },
      });

      const currentBalance = latest?.balanceAfter ?? 0;
      const newBalance = quota;
      const delta = quota - currentBalance;

      await tx.aiCreditLedger.create({
        data: {
          organizationId: org.id,
          delta,
          reason: 'monthly_reset',
          messageId,
          credits: quota,
          balanceAfter: newBalance,
        },
      });

      resetCount++;
    }

    return { locked: true, period, resetCount, skippedCount };
  });
};
