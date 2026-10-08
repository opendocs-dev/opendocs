import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MemberItem, PendingInvitation } from '@/lib/server-api';

const realNavigation = await import('next/navigation');
mock.module('next/navigation', () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

const { MembersManager } = await import('./members-manager');

const sampleMembers: MemberItem[] = [
  {
    id: 'mem_1',
    user_id: 'user_1',
    name: 'Alice Owner',
    email: 'alice@example.com',
    image: null,
    role: 'owner',
    member_since: '2026-09-01T00:00:00Z',
  },
  {
    id: 'mem_2',
    user_id: 'user_2',
    name: 'Bob Admin',
    email: 'bob@example.com',
    image: null,
    role: 'admin',
    member_since: '2026-09-10T00:00:00Z',
  },
  {
    id: 'mem_3',
    user_id: 'user_3',
    name: 'Carol Editor',
    email: 'carol@example.com',
    image: null,
    role: 'editor',
    member_since: '2026-09-15T00:00:00Z',
  },
];

const sampleInvitations: PendingInvitation[] = [
  {
    id: 'inv_1',
    email: 'dave@example.com',
    role: 'editor',
    expires_at: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
    invited_at: '2026-10-01T00:00:00Z',
  },
];

describe('MembersManager', () => {
  test('tables do not use class "adm" (finding 1)', () => {
    const html = renderToStaticMarkup(
      <MembersManager
        members={sampleMembers}
        invitations={sampleInvitations}
        currentUserRole="owner"
      />,
    );
    expect(html).not.toContain('<table class="adm"');
    expect(html).not.toContain('<table className="adm"');
    expect(html).toContain('<table>');
  });

  test('layout order: Members first, Invite by email second, Role matrix third (finding 2)', () => {
    const html = renderToStaticMarkup(
      <MembersManager
        members={sampleMembers}
        invitations={sampleInvitations}
        currentUserRole="owner"
      />,
    );
    const membersIndex = html.indexOf('<h3>Members</h3>');
    const inviteIndex = html.indexOf('<h3>Invite by email</h3>');
    const matrixIndex = html.indexOf('<h3>What each role can do</h3>');

    expect(membersIndex).toBeGreaterThan(-1);
    expect(inviteIndex).toBeGreaterThan(membersIndex);
    expect(matrixIndex).toBeGreaterThan(inviteIndex);
  });

  test('renders person column with avatar, bold name, and email underneath (finding 4)', () => {
    const html = renderToStaticMarkup(
      <MembersManager
        members={sampleMembers}
        invitations={[]}
        currentUserRole="owner"
      />,
    );
    expect(html).toContain('<span class="av">AO</span>');
    expect(html).toContain('Alice Owner');
    expect(html).toContain('alice@example.com');
  });

  test('role control: owner has static badge and no remove button; admin/editor have select with only admin and editor (finding 5)', () => {
    const html = renderToStaticMarkup(
      <MembersManager
        members={sampleMembers}
        invitations={[]}
        currentUserRole="owner"
      />,
    );
    // Owner row has static badge
    expect(html).toContain('<span class="badge">Owner</span>');

    // Role select contains Admin and Editor, but not Owner
    expect(html).toContain('<option value="admin">Admin</option>');
    expect(html).toContain('<option value="editor">Editor</option>');
    expect(html).not.toContain('<option value="owner">Owner</option>');

    // Owner does not have a Remove button
    // There are 3 members (1 owner, 1 admin, 1 editor) -> exactly 2 Remove buttons
    const removeCount = (html.match(/>Remove</g) || []).length;
    expect(removeCount).toBe(2);
  });

  test('pending invite sits in the members table with avatar ?, warn badge, resend and cancel (finding 6)', () => {
    const html = renderToStaticMarkup(
      <MembersManager
        members={sampleMembers}
        invitations={sampleInvitations}
        currentUserRole="owner"
      />,
    );
    // Avatar "?" and email
    expect(html).toContain('<span class="av">?</span>');
    expect(html).toContain('dave@example.com');
    expect(html).toContain('Invited, expires in 6 days');

    // Warn badge
    expect(html).toContain('class="badge badge-warn"');
    expect(html).toContain('Editor · pending');

    // Resend and Cancel buttons
    expect(html).toContain('Resend');
    expect(html).toContain('Cancel');
  });

  test('invite card has correct title, grid2 layout, placeholder, button, and expiry hint (finding 7)', () => {
    const html = renderToStaticMarkup(
      <MembersManager
        members={sampleMembers}
        invitations={[]}
        currentUserRole="owner"
      />,
    );
    expect(html).toContain('<h3>Invite by email</h3>');
    expect(html).toContain('class="grid2"');
    expect(html).toContain('placeholder="name@company.com"');
    expect(html).toContain('Send invite');
    expect(html).toContain('They sign in with GitHub using the invited email. Invites expire after 7 days.');
  });

  test('role matrix has 7 rows, empty first header, and check icons (finding 9)', () => {
    const html = renderToStaticMarkup(
      <MembersManager
        members={sampleMembers}
        invitations={[]}
        currentUserRole="owner"
      />,
    );
    expect(html).toContain('<th></th><th>Owner</th><th>Admin</th><th>Editor</th>');
    expect(html).toContain('Guides, categories, analytics');
    expect(html).toContain('AI assistant, conversations');
    expect(html).toContain('Appearance, domain, SEO, storage');
    expect(html).toContain('API keys and MCP');
    expect(html).toContain('Members and activity log');
    expect(html).toContain('Billing and plan changes');
    expect(html).toContain('Delete or transfer the workspace');
  });

  test('renders Last active column header and values (UI-A14 finding 4)', () => {
    const membersWithActive: MemberItem[] = [
      {
        id: 'mem_1',
        user_id: 'user_1',
        name: 'Alice Owner',
        email: 'alice@example.com',
        image: null,
        role: 'owner',
        member_since: '2026-09-01T00:00:00Z',
        last_active_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago -> Today
      },
      {
        id: 'mem_2',
        user_id: 'user_2',
        name: 'Bob Admin',
        email: 'bob@example.com',
        image: null,
        role: 'admin',
        member_since: '2026-09-10T00:00:00Z',
        last_active_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
      },
      {
        id: 'mem_3',
        user_id: 'user_3',
        name: 'Carol Editor',
        email: 'carol@example.com',
        image: null,
        role: 'editor',
        member_since: '2026-09-15T00:00:00Z',
        last_active_at: null, // Never
      },
    ];

    const html = renderToStaticMarkup(
      <MembersManager
        members={membersWithActive}
        invitations={sampleInvitations}
        currentUserRole="owner"
      />,
    );
    expect(html).toContain('<th>Last active</th>');
    expect(html).toContain('<td>Today</td>');
    expect(html).toContain('<td>3 days ago</td>');
    expect(html).toContain('<td>Never</td>');
  });

  test('editor cannot manage members, invites, or see invite card (finding 15)', () => {
    const html = renderToStaticMarkup(
      <MembersManager
        members={sampleMembers}
        invitations={sampleInvitations}
        currentUserRole="editor"
      />,
    );
    expect(html).not.toContain('<h3>Invite by email</h3>');
    expect(html).not.toContain('<th>Actions</th>');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('Resend');
  });
});
