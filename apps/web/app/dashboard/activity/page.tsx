import Link from 'next/link';
import { getActivityLogs } from '@/lib/server-api';
import { ActivityManager } from './activity-manager';

export const metadata = { title: 'Activity log — OpenDocs' };

export default async function ActivityPage() {
  const data = await getActivityLogs();

  if (!data) {
    return (
      <div className="stack">
        <div className="adm-pane-header">
          <div>
            <h1>Activity log</h1>
            <div>Who changed what in the workspace, for audits.</div>
          </div>
        </div>
        <p role="alert">
          Could not load activity log. <Link href="/dashboard/activity">Retry</Link>
        </p>
      </div>
    );
  }

  return (
    <ActivityManager
      initialLogs={data.activity_logs}
      retentionDays={data.retention_days}
      canExport={data.can_export}
      initialNextCursor={data.next_cursor ?? null}
      initialHasMore={data.has_more ?? false}
    />
  );
}
