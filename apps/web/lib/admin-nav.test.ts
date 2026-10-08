import { describe, expect, test } from 'bun:test';
import { normalizeRole, roleLabel, initials, menuFor, isActive, CATEGORIES_READY } from './admin-nav';

describe('normalizeRole', () => {
  test('converts owner', () => {
    expect(normalizeRole('owner')).toBe('owner');
  });

  test('converts admin', () => {
    expect(normalizeRole('admin')).toBe('admin');
  });

  test('converts editor', () => {
    expect(normalizeRole('editor')).toBe('editor');
  });

  test('converts undefined to editor', () => {
    expect(normalizeRole(undefined)).toBe('editor');
  });

  test('converts null to editor', () => {
    expect(normalizeRole(null)).toBe('editor');
  });

  test('converts member to editor', () => {
    expect(normalizeRole('member')).toBe('editor');
  });

  test('converts unknown role to editor', () => {
    expect(normalizeRole('unknown')).toBe('editor');
  });
});

describe('roleLabel', () => {
  test('returns Owner for owner', () => {
    expect(roleLabel('owner')).toBe('Owner');
  });

  test('returns Admin for admin', () => {
    expect(roleLabel('admin')).toBe('Admin');
  });

  test('returns Editor for editor', () => {
    expect(roleLabel('editor')).toBe('Editor');
  });
});

describe('initials', () => {
  test('extracts first letter of first and second word from a name', () => {
    expect(initials('John Doe')).toBe('JD');
  });

  test('extracts first letter when only one word', () => {
    expect(initials('Alice')).toBe('A');
  });

  test('ignores extra words beyond the second', () => {
    expect(initials('John Paul Doe')).toBe('JP');
  });

  test('trims whitespace', () => {
    expect(initials('  John  Doe  ')).toBe('JD');
  });

  test('returns first letter of email when name is null', () => {
    expect(initials(null, 'alice@example.com')).toBe('A');
  });

  test('returns first letter of email when name is undefined', () => {
    expect(initials(undefined, 'bob@example.com')).toBe('B');
  });

  test('returns ? when name and email are both missing', () => {
    expect(initials(null, null)).toBe('?');
  });

  test('returns ? when name and email are both undefined', () => {
    expect(initials(undefined, undefined)).toBe('?');
  });

  test('prefers name over email', () => {
    expect(initials('John Doe', 'alice@example.com')).toBe('JD');
  });

  test('uppercases letters', () => {
    expect(initials('john doe')).toBe('JD');
  });
});

describe('menuFor', () => {
  test('editor gets Content group with Overview, Guides, Categories, and Analytics', () => {
    const menu = menuFor('editor');
    expect(menu).toHaveLength(1);
    expect(menu[0].label).toBe('Content');
    expect(menu[0].items).toHaveLength(4);
  });

  test('admin gets Content, Assistant, Site and Workspace groups', () => {
    const menu = menuFor('admin');
    expect(menu).toHaveLength(4);
    expect(menu.map((g) => g.label)).toEqual(['Content', 'Assistant', 'Site', 'Workspace']);
  });

  test('owner gets Content, Assistant, Site and Workspace groups', () => {
    const menu = menuFor('owner');
    expect(menu).toHaveLength(4);
    expect(menu.map((g) => g.label)).toEqual(['Content', 'Assistant', 'Site', 'Workspace']);
  });

  test('Assistant group has AI assistant and Conversations links', () => {
    const menu = menuFor('admin');
    const assistant = menu.find((g) => g.label === 'Assistant');
    expect(assistant?.items).toEqual([
      { href: '/dashboard/assistant', label: 'AI assistant' },
      { href: '/dashboard/assistant/conversations', label: 'Conversations' },
    ]);
  });

  test('Content group has Overview, Guides, Categories, and Analytics links', () => {
    const menu = menuFor('editor');
    const content = menu[0];
    expect(content.items[0]).toEqual({ href: '/dashboard', label: 'Overview' });
    expect(content.items[1]).toEqual({ href: '/dashboard/guides', label: 'Guides' });
    expect(content.items[2]).toEqual({ href: '/dashboard/categories', label: 'Categories' });
    expect(content.items[3]).toEqual({ href: '/dashboard/analytics', label: 'Analytics' });
  });

  test('Site group has Domain, Appearance, and SEO links', () => {
    const menu = menuFor('admin');
    const site = menu.find((g) => g.label === 'Site');
    expect(site?.items).toEqual([
      { href: '/dashboard/site', label: 'Domain' },
      { href: '/dashboard/site/appearance', label: 'Appearance' },
      { href: '/dashboard/site/seo', label: 'SEO' },
    ]);
  });

  test('Workspace group excludes Billing for owner by default (BILLING_READY off)', () => {
    const menu = menuFor('owner');
    const workspace = menu.find((g) => g.label === 'Workspace');
    expect(workspace?.items).toEqual([
      { href: '/dashboard/members', label: 'Members' },
      { href: '/dashboard/keys', label: 'API and MCP' },
      { href: '/dashboard/activity', label: 'Activity log' },
      { href: '/dashboard/storage', label: 'Storage' },
      { href: '/dashboard/plan', label: 'Plan and usage' },
    ]);
  });

  test('Workspace group includes Billing for owner when billingReady is true', () => {
    const menu = menuFor('owner', true);
    const workspace = menu.find((g) => g.label === 'Workspace');
    expect(workspace?.items).toEqual([
      { href: '/dashboard/members', label: 'Members' },
      { href: '/dashboard/keys', label: 'API and MCP' },
      { href: '/dashboard/activity', label: 'Activity log' },
      { href: '/dashboard/storage', label: 'Storage' },
      { href: '/dashboard/billing', label: 'Billing' },
      { href: '/dashboard/plan', label: 'Plan and usage' },
    ]);
  });

  test('Workspace group excludes Billing for admin even when billingReady is true', () => {
    const menu = menuFor('admin', true);
    const workspace = menu.find((g) => g.label === 'Workspace');
    expect(workspace?.items).toEqual([
      { href: '/dashboard/members', label: 'Members' },
      { href: '/dashboard/keys', label: 'API and MCP' },
      { href: '/dashboard/activity', label: 'Activity log' },
      { href: '/dashboard/storage', label: 'Storage' },
      { href: '/dashboard/plan', label: 'Plan and usage' },
    ]);
  });

  test('editor does not get a Workspace group', () => {
    const menu = menuFor('editor');
    expect(menu.find((g) => g.label === 'Workspace')).toBeUndefined();
  });
});

describe('isActive', () => {
  test('matches /dashboard exactly', () => {
    expect(isActive('/dashboard', '/dashboard')).toBe(true);
  });

  test('does not match /dashboard for sub-paths like /dashboard/flows', () => {
    expect(isActive('/dashboard', '/dashboard/flows')).toBe(false);
  });

  test('matches /dashboard/flows for exact path', () => {
    expect(isActive('/dashboard/flows', '/dashboard/flows')).toBe(true);
  });

  test('matches /dashboard/flows for sub-paths like /dashboard/flows/slug', () => {
    expect(isActive('/dashboard/flows', '/dashboard/flows/some-flow')).toBe(true);
  });

  test('does not match when path is prefix but not a complete segment', () => {
    expect(isActive('/dashboard/cat', '/dashboard/categories')).toBe(false);
  });

  test('matches /dashboard/site for /dashboard/site exactly', () => {
    expect(isActive('/dashboard/site', '/dashboard/site')).toBe(true);
  });

  test('does not match /dashboard/site for sibling routes like /dashboard/site/appearance or /dashboard/site/seo', () => {
    expect(isActive('/dashboard/site', '/dashboard/site/appearance')).toBe(false);
    expect(isActive('/dashboard/site', '/dashboard/site/seo')).toBe(false);
  });

  test('matches /dashboard/site/appearance for /dashboard/site/appearance', () => {
    expect(isActive('/dashboard/site/appearance', '/dashboard/site/appearance')).toBe(true);
  });

  test('matches /dashboard/assistant for /dashboard/assistant exactly', () => {
    expect(isActive('/dashboard/assistant', '/dashboard/assistant')).toBe(true);
  });

  test('does not match /dashboard/assistant for sibling route /dashboard/assistant/conversations', () => {
    expect(isActive('/dashboard/assistant', '/dashboard/assistant/conversations')).toBe(false);
  });

  test('matches /dashboard/assistant/conversations for /dashboard/assistant/conversations', () => {
    expect(isActive('/dashboard/assistant/conversations', '/dashboard/assistant/conversations')).toBe(true);
  });

  test('matches /dashboard/storage for /dashboard/storage', () => {
    expect(isActive('/dashboard/storage', '/dashboard/storage')).toBe(true);
  });
});
