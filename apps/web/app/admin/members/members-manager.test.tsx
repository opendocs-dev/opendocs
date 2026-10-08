import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MemberItem } from '@/lib/server-api';

const { MembersManager } = await import('./members-manager');

const sampleMembers: MemberItem[] = [
  { id: 'mem_1', user_id: 'user_1', name: 'Alice Owner', email: 'alice@example.com', image: null, role: 'owner', member_since: '2026-09-01T00:00:00Z' },
  { id: 'mem_2', user_id: 'user_2', name: 'Bob Admin', email: 'bob@example.com', image: null, role: 'admin', member_since: '2026-09-10T00:00:00Z' },
  { id: 'mem_3', user_id: 'user_3', name: 'Carol Editor', email: 'carol@example.com', image: null, role: 'editor', member_since: '2026-09-15T00:00:00Z' },
];

describe('MembersManager (list only, C23)', () => {
  test('lists every member with a static role badge', () => {
    const html = renderToStaticMarkup(<MembersManager members={sampleMembers} />);
    expect(html).toContain('Alice Owner');
    expect(html).toContain('bob@example.com');
    expect(html).toContain('<span class="badge">Admin</span>');
    expect(html).toContain('<span class="badge">Editor</span>');
    expect(html).not.toContain('<select');
  });

  test('has no invite, resend, cancel or remove controls', () => {
    const html = renderToStaticMarkup(<MembersManager members={sampleMembers} />);
    expect(html).not.toContain('Invite');
    expect(html).not.toContain('Resend');
    expect(html).not.toContain('Remove');
  });

  test('shows the role matrix without billing rows', () => {
    const html = renderToStaticMarkup(<MembersManager members={sampleMembers} />);
    expect(html).toContain('<h3>What each role can do</h3>');
    expect(html).not.toContain('Billing');
  });
});
