import Link from 'next/link';
import { getMembers, getMe } from '@/lib/server-api';
import { normalizeRole } from '@/lib/admin-nav';
import { MembersManager } from './members-manager';

export const metadata = { title: 'Members — OpenDocs' };

export default async function MembersPage() {
  const [members, me] = await Promise.all([getMembers(), getMe()]);
  const role = normalizeRole(me?.role);
  const canManage = role === 'owner' || role === 'admin';
  const totalCount = members?.members
    ? members.members.length + (members.invitations?.length ?? 0)
    : 0;
  const countLabel = `${totalCount} ${totalCount === 1 ? 'person' : 'people'}`;
  const workspaceName = me?.workspace?.name;
  const subtitle = members?.members
    ? workspaceName
      ? `${countLabel} in ${workspaceName}`
      : countLabel
    : 'Invite people to this workspace and manage their roles.';

  return (
    <div className="stack">
      <div className="adm-pane-header">
        <div>
          <h1>Members</h1>
          <div>{subtitle}</div>
        </div>
        {members?.members && canManage && (
          <a href="#invite" className="btn btn-primary">
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M8 3v10M3 8h10" />
            </svg>
            Invite member
          </a>
        )}
      </div>

      {!members?.members ? (
        <p role="alert">
          Could not load members. <Link href="/dashboard/members">Retry</Link>
        </p>
      ) : (
        <MembersManager
          members={members.members}
          invitations={members.invitations ?? []}
          currentUserRole={role}
        />
      )}
    </div>
  );
}
