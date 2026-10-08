import Link from 'next/link';
import { getMembers, getMe } from '@/lib/server-api';
import { MembersManager } from './members-manager';

export const metadata = { title: 'Members — OpenDocs' };

export default async function MembersPage() {
  const [members, me] = await Promise.all([getMembers(), getMe()]);
  const totalCount = members?.members ? members.members.length : 0;
  const countLabel = `${totalCount} ${totalCount === 1 ? 'person' : 'people'}`;
  const workspaceName = me?.workspace?.name;
  const subtitle = members?.members
    ? workspaceName
      ? `${countLabel} in ${workspaceName}`
      : countLabel
    : 'Who has access to this workspace.';

  return (
    <div className="stack">
      <div className="adm-pane-header">
        <div>
          <h1>Members</h1>
          <div>{subtitle}</div>
        </div>
      </div>

      {!members?.members ? (
        <p role="alert">
          Could not load members. <Link href="/admin/members">Retry</Link>
        </p>
      ) : (
        <MembersManager members={members.members} />
      )}
    </div>
  );
}
