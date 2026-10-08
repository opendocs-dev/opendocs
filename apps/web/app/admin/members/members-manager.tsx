import type { MemberItem } from '@/lib/server-api';
import { initials, roleLabel } from '@/lib/admin-nav';

type Props = {
  members: MemberItem[];
};

const ROLE_MATRIX: Array<{ action: string; owner: boolean; admin: boolean; editor: boolean }> = [
  { action: 'Guides, categories, analytics', owner: true, admin: true, editor: true },
  { action: 'Appearance and SEO', owner: true, admin: true, editor: false },
  { action: 'API keys and MCP', owner: true, admin: true, editor: false },
  { action: 'Members and activity log', owner: true, admin: true, editor: false },
];

export function formatLastActive(isoString?: string | null): string {
  if (!isoString) return 'Never';
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return 'Never';
  const diffMs = Date.now() - then;
  if (diffMs < 0) return 'Today';
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffHours < 24) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return `${diffDays} days ago`;
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="var(--a-ok, currentColor)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}

export function MembersManager({ members }: Props) {
  return (
    <div className="stack">
      <div className="card tw">
        <h3>Members</h3>
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th>Last active</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="av">{initials(member.name, member.email)}</span>
                    <span>
                      <strong style={{ display: 'block' }}>{member.name || member.email}</strong>
                      {member.name && (
                        <small style={{ display: 'block', color: 'var(--a-muted)' }}>
                          {member.email}
                        </small>
                      )}
                    </span>
                  </div>
                </td>
                <td>
                  <span className="badge">{roleLabel(member.role)}</span>
                </td>
                <td>{formatLastActive(member.last_active_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Role matrix card (Finding 9) */}
      <div className="card tw">
        <h3>What each role can do</h3>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Owner</th>
              <th>Admin</th>
              <th>Editor</th>
            </tr>
          </thead>
          <tbody>
            {ROLE_MATRIX.map((row) => (
              <tr key={row.action}>
                <td>{row.action}</td>
                <td>{row.owner ? <CheckIcon /> : <span style={{ color: 'var(--a-muted)' }}>—</span>}</td>
                <td>{row.admin ? <CheckIcon /> : <span style={{ color: 'var(--a-muted)' }}>—</span>}</td>
                <td>{row.editor ? <CheckIcon /> : <span style={{ color: 'var(--a-muted)' }}>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
