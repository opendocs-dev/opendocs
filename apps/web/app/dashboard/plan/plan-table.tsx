import type { PlanMatrixEntry } from '@/lib/server-api';
import { formatPlanName } from '../usage-format';

interface PlanCardsProps {
  currentPlan: string;
  plans: PlanMatrixEntry[];
}

export type PlanFeatureItem = {
  text: string;
  included: boolean;
};

export function getPlanFeatures(entry: PlanMatrixEntry): PlanFeatureItem[] {
  const plan = entry.plan.toLowerCase();

  if (plan === 'free') {
    return [
      { text: 'Guides, categories, search', included: true },
      { text: '1 look preset (Sage)', included: true },
      { text: 'Images on OpenDocs storage (100 MiB)', included: true },
      { text: 'More look presets', included: false },
      { text: 'No "Powered by OpenDocs" footer', included: false },
      { text: 'AI assistant', included: false },
      { text: 'Custom colors, font, logo', included: false },
      { text: 'Your own domain and custom meta', included: false },
    ];
  }

  if (plan === 'pro') {
    return [
      { text: 'Guides, categories, search', included: true },
      { text: '3 look presets', included: true },
      { text: 'Images on own Google Drive', included: true },
      { text: 'No "Powered by OpenDocs" footer', included: true },
      { text: 'AI assistant, 1,000 credits a month', included: true },
      { text: 'Custom colors, font, logo', included: false },
      { text: 'Your own domain and custom meta', included: false },
      { text: 'Your own provider, embed anywhere', included: false },
    ];
  }

  if (plan === 'enterprise') {
    return [
      { text: 'Guides, categories, search', included: true },
      { text: '3 look presets', included: true },
      { text: 'Images on own Drive or S3', included: true },
      { text: 'No "Powered by OpenDocs" footer', included: true },
      { text: 'AI assistant, 10,000 credits a month', included: true },
      { text: 'Your own provider, embed anywhere', included: true },
      { text: 'Custom colors, font, logo', included: true },
      { text: 'Your own domain and custom meta', included: true },
    ];
  }

  // Fallback for custom or dynamically configured plan entries based on capabilities
  const items: PlanFeatureItem[] = [
    { text: 'Guides, categories, search', included: true },
  ];

  if (entry.capabilities.presetCount > 1) {
    items.push({ text: `${entry.capabilities.presetCount} look presets`, included: true });
  } else {
    items.push({ text: '1 look preset (Sage)', included: true });
    items.push({ text: 'More look presets', included: false });
  }

  if (entry.capabilities.storageKinds.includes('s3')) {
    items.push({ text: 'Images on own Drive or S3', included: true });
  } else if (entry.capabilities.storageKinds.includes('gdrive')) {
    items.push({ text: 'Images on own Google Drive', included: true });
  } else {
    items.push({ text: 'Images on OpenDocs storage (100 MiB)', included: true });
  }

  items.push({
    text: 'No "Powered by OpenDocs" footer',
    included: !entry.capabilities.footerCredit,
  });

  if (entry.capabilities.aiAssistant) {
    items.push({ text: 'AI assistant', included: true });
  } else {
    items.push({ text: 'AI assistant', included: false });
  }

  items.push({
    text: 'Custom colors, font, logo',
    included: entry.capabilities.customPreset,
  });

  items.push({
    text: 'Your own domain and custom meta',
    included: entry.capabilities.customDomain,
  });

  return items;
}

function CheckIcon() {
  return (
    <svg
      className="plan-list-icon"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M13.25 4.75L6 12L2.75 8.75"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg
      className="plan-list-icon"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M11.5 4.5L4.5 11.5M4.5 4.5l7 7"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Three-plan cards (AC-15, UI-A10 Findings 1, 2, 3, 8).
 * Renders three side-by-side cards (Free, Pro, Enterprise) with green check rows
 * for what is included and grey X rows for what is not.
 * The current plan has a 2px brand border and an inline "Current" badge.
 */
export function PlanCards({ currentPlan, plans }: PlanCardsProps) {
  return (
    <div className="grid3">
      {plans.map((entry) => {
        const isCurrent = entry.plan === currentPlan;
        const features = getPlanFeatures(entry);

        return (
          <div
            key={entry.plan}
            className={`card plan-card ${isCurrent ? 'plan-card-current' : ''}`}
          >
            <div className="plan-card-header">
              <h3>{formatPlanName(entry.plan)}</h3>
              {isCurrent && <span className="badge badge-ok">Current</span>}
            </div>

            <ul className="plan-list">
              {features.map((item) => (
                <li
                  key={item.text}
                  className={`plan-list-item ${item.included ? 'included' : 'excluded'}`}
                >
                  {item.included ? <CheckIcon /> : <CrossIcon />}
                  <span className="sr-only">
                    {item.included ? 'Included: ' : 'Excluded: '}
                  </span>
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export const PlanTable = PlanCards;
