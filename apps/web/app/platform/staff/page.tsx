import Link from 'next/link';
import { getPlatformStaff, getPlatformAuditLogs, getPlatformMe } from '@/lib/server-api';
import { StaffManager } from './staff-manager';

export const metadata = { title: 'Staff and audit log — OpenDocs' };

export default async function PlatformStaffPage() {
  const [{ staff }, { auditLogs }, { staff: me }] = await Promise.all([
    getPlatformStaff(),
    getPlatformAuditLogs(),
    getPlatformMe(),
  ]);

  if (!staff || !auditLogs || !me) {
    return (
      <div className="stack">
        <p role="alert">
          Could not load staff and audit log. <Link href="/platform/staff">Retry</Link>
        </p>
      </div>
    );
  }

  return (
    <StaffManager
      initialStaff={staff}
      initialAuditLogs={auditLogs}
      currentRole={me.role}
      currentUserId={me.id}
    />
  );
}
