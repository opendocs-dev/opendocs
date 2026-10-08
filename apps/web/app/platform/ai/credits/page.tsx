import { getPlatformAiLimits, getPlatformMe } from '@/lib/server-api';
import { CreditsManager } from './credits-manager';

export const metadata = { title: 'Credits and limits — OpenDocs' };

export default async function PlatformAiCreditsPage() {
  const [{ settings, plans, forbidden }, { staff }] = await Promise.all([
    getPlatformAiLimits(),
    getPlatformMe(),
  ]);

  if (forbidden || !staff) {
    return (
      <div className="stack">
        <p role="alert">
          Platform staff access required. Ask an existing platform admin to add your account as staff.
        </p>
      </div>
    );
  }

  return (
    <CreditsManager
      initialSettings={settings}
      initialPlans={plans}
      currentRole={staff.role}
    />
  );
}
