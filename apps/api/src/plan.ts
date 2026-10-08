import { DAILY_QUOTAS, type Plan } from '@opendocs/core';
import { getPrisma } from './db';

/**
 * A workspace without a WorkspaceBilling row has never subscribed, so it is on Free.
 * The column is a plain string, so anything that is not a known plan is treated as Free
 * rather than trusted (an unknown value would otherwise break quota and step limits).
 */
export const getPlan = async (organizationId: string): Promise<Plan> => {
  const billing = await getPrisma().workspaceBilling.findUnique({
    where: { organizationId },
    select: { plan: true },
  });

  const plan = billing?.plan;
  return plan && plan in DAILY_QUOTAS ? (plan as Plan) : 'free';
};

/**
 * Plan capability gate (C14 Decisions, AC-15): what each plan is allowed, independent of
 * whether the feature itself is built yet. Appearance (presets) and other screens read
 * this instead of hardcoding plan comparisons, so the matrix stays in one place.
 */
export type PlanCapabilities = {
  /** Preset count the plan may choose from (C14 Decisions: Free 1, Pro 3, Enterprise 3 plus custom). */
  presetCount: number;
  /** Whether the plan may set custom colors, font, radius and logo on top of a preset. */
  customPreset: boolean;
  /** Storage destinations the plan may connect, matching `storage.ts`'s `allowedKinds`. */
  storageKinds: readonly ('gdrive' | 's3')[];
  /** Whether the OpenDocs footer credit shows on this plan's docs (Free only). */
  footerCredit: boolean;
  /** Whether the AI assistant is available on this plan (not built yet; AC-18..20). */
  aiAssistant: boolean;
  /** Whether a custom domain and custom meta tags are available (Enterprise only). */
  customDomain: boolean;
};

const PLAN_CAPABILITIES: Record<Plan, PlanCapabilities> = {
  free: {
    presetCount: 1,
    customPreset: false,
    storageKinds: [],
    footerCredit: true,
    aiAssistant: false,
    customDomain: false,
  },
  pro: {
    presetCount: 3,
    customPreset: false,
    storageKinds: ['gdrive'],
    footerCredit: false,
    aiAssistant: true,
    customDomain: false,
  },
  enterprise: {
    presetCount: 3,
    customPreset: true,
    storageKinds: ['gdrive', 's3'],
    footerCredit: false,
    aiAssistant: true,
    customDomain: true,
  },
};

/** Returns what `plan` is allowed. Pass the result of `getPlan`, never a raw/unvalidated string. */
export const capabilitiesFor = (plan: Plan): PlanCapabilities => PLAN_CAPABILITIES[plan];
