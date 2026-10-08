import Link from 'next/link';
import { getPlatformReports, getPlatformMe } from '@/lib/server-api';
import { ReportsManager } from './reports-manager';

export const metadata = { title: 'Reports — OpenDocs' };

export default async function PlatformReportsPage() {
  const [{ reports, counts, forbidden }, { staff: me }] = await Promise.all([
    getPlatformReports(),
    getPlatformMe(),
  ]);

  if (forbidden || !me) {
    return (
      <div className="stack">
        <p role="alert">
          Platform staff access required. Ask an existing platform admin to add your account as staff.
        </p>
      </div>
    );
  }

  if (!reports || !counts) {
    return (
      <div className="stack">
        <p role="alert">
          Could not load reports queue. <Link href="/platform/reports">Retry</Link>
        </p>
      </div>
    );
  }

  return (
    <ReportsManager
      initialReports={reports}
      initialCounts={counts}
      currentRole={me.role}
      currentUserId={me.id}
    />
  );
}
