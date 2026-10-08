import { getAssistant, getPlanInfo, getStorage } from '@/lib/server-api';
import {
  formatAiCreditsUsage,
  formatBytesUsage,
  formatFilesUsage,
  formatPlanName,
  formatStorageUsage,
  quotaFor,
  usagePercent,
} from '../usage-format';
import { PlanCards } from './plan-table';

export const metadata = { title: 'Plan and usage — OpenDocs' };

export default async function PlanPage() {
  const [info, storage, assistantData] = await Promise.all([
    getPlanInfo(),
    getStorage().catch(() => null),
    getAssistant().catch(() => null),
  ]);

  if (!info) {
    return (
      <div className="stack">
        <div className="adm-pane-header">
          <div>
            <h1>Plan and usage</h1>
          </div>
        </div>
        <p role="alert">Could not load plan information. Refresh the page to try again.</p>
      </div>
    );
  }

  // Storage usage calculation (AC-15, UI-A10 Finding 4 & 6)
  const plan = info.plan.toLowerCase();
  const defaultStorageLimitMiB = plan === 'free' ? 100 : plan === 'pro' ? 1000 : 10000;
  const storageLimitMiB = storage?.usage?.bytes_limit
    ? Math.round(storage.usage.bytes_limit / (1024 * 1024))
    : defaultStorageLimitMiB;
  const storageUsedMiB = storage?.usage?.bytes_used
    ? Math.round(storage.usage.bytes_used / (1024 * 1024))
    : 0;
  const storagePercent =
    storageLimitMiB > 0
      ? Math.min(100, Math.max(0, Math.round((storageUsedMiB / storageLimitMiB) * 100)))
      : 0;

  const storageDestination =
    storage?.active_kind === 'gdrive'
      ? 'own Google Drive'
      : storage?.active_kind === 's3'
        ? 'own Drive or S3'
        : 'OpenDocs storage';

  // AI credits calculation (AC-15, UI-A10 Finding 4)
  const defaultAiCreditsTotal = plan === 'enterprise' ? 10000 : plan === 'pro' ? 1000 : 0;
  const aiCreditsTotal = assistantData?.credits?.total ?? defaultAiCreditsTotal;
  const aiCreditsUsed = assistantData?.credits?.used ?? 0;
  const aiCreditsPercent =
    aiCreditsTotal > 0
      ? Math.min(100, Math.max(0, Math.round((aiCreditsUsed / aiCreditsTotal) * 100)))
      : 0;

  // Daily upload usage calculation (UI-A10 Owner decision 3, re-added from pre-PR 121)
  const ownPlanQuota =
    info.plans?.find((entry) => entry.plan === info.plan)?.quota ?? quotaFor(info.plan);
  const dailyUploadPercent =
    info && ownPlanQuota ? usagePercent(info.quota.files_left, ownPlanQuota.files) : 0;

  return (
    <div className="stack">
      <div className="adm-pane-header">
        <div>
          <h1>Plan and usage</h1>
          <div>
            You are on <strong>{formatPlanName(info.plan)}</strong>
          </div>
        </div>
        <a href="mailto:sales@example.com" className="btn">
          Contact sales
        </a>
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Image storage</h3>
          <div
            className="meter"
            role="progressbar"
            aria-label="Image storage"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={storagePercent}
          >
            <div className="meter-fill" style={{ width: `${storagePercent}%` }} />
          </div>
          <div className="meter-caption">
            {formatStorageUsage(storageUsedMiB, storageLimitMiB, storageDestination, info.plan)}
          </div>
        </div>

        <div className="card">
          <h3>AI credits this month</h3>
          <div
            className="meter"
            role="progressbar"
            aria-label="AI credits this month"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={aiCreditsPercent}
          >
            <div className="meter-fill" style={{ width: `${aiCreditsPercent}%` }} />
          </div>
          <div className="meter-caption">
            {formatAiCreditsUsage(aiCreditsUsed, aiCreditsTotal)}
          </div>
        </div>
      </div>

      {ownPlanQuota && (
        <div className="card">
          <h3>Your plan: {formatPlanName(info.plan)}</h3>
          <p>{formatFilesUsage(info.quota.files_left, ownPlanQuota.files)}</p>
          <div
            className="meter bar"
            role="progressbar"
            aria-label="Files used today"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={dailyUploadPercent}
          >
            <div className="meter-fill bar-fill" style={{ width: `${dailyUploadPercent}%` }} />
          </div>
          <p className="meter-caption muted">{formatBytesUsage(info.quota.bytes_left, ownPlanQuota.bytes)}</p>
        </div>
      )}

      <PlanCards currentPlan={info.plan} plans={info.plans ?? []} />
    </div>
  );
}
