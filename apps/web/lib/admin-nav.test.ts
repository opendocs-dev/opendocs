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
    expect(menu).toHaveLength(3);
    expect(menu.map((g) => g.label)).toEqual(['Content', 'Site', 'Workspace']);
  });

  test('owner gets Content, Assistant, Site and Workspace groups', () => {
    const menu = menuFor('owner');
    expect(menu).toHaveLength(3);
    expect(menu.map((g) => g.label)).toEqual(['Content', 'Site', 'Workspace']);
  });

  test('Content group has Overview, Guides, Categories, and Analytics links', () => {
    const menu = menuFor('editor');
    const content = menu[0];
    expect(content.items[0]).toEqual({ href: '/admin', label: 'Overview' });
    expect(content.items[1]).toEqual({ href: '/admin/guides', label: 'Guides' });
    expect(content.items[2]).toEqual({ href: '/admin/categories', label: 'Categories' });
    expect(content.items[3]).toEqual({ href: '/admin/analytics', label: 'Analytics' });
  });

  test('Site group has Appearance and SEO links', () => {
    const menu = menuFor('admin');
    const site = menu.find((g) => g.label === 'Site');
    expect(site?.items).toEqual([
      { href: '/admin/site/appearance', label: 'Appearance' },
      { href: '/admin/site/seo', label: 'SEO' },
    ]);
  });

  test('Workspace group has Members, API and MCP, and Activity log only', () => {
    for (const role of ['owner', 'admin'] as const) {
      const workspace = menuFor(role).find((g) => g.label === 'Workspace');
      expect(workspace?.items).toEqual([
        { href: '/admin/members', label: 'Members' },
        { href: '/admin/keys', label: 'API and MCP' },
        { href: '/admin/activity', label: 'Activity log' },
      ]);
    }
  });

  test('editor does not get a Workspace group', () => {
    const menu = menuFor('editor');
    expect(menu.find((g) => g.label === 'Workspace')).toBeUndefined();
  });
});

describe('isActive', () => {
  test('matches /admin exactly', () => {
    expect(isActive('/admin', '/admin')).toBe(true);
  });

  test('does not match /admin for sub-paths like /admin/flows', () => {
    expect(isActive('/admin', '/admin/flows')).toBe(false);
  });

  test('matches /admin/flows for exact path', () => {
    expect(isActive('/admin/flows', '/admin/flows')).toBe(true);
  });

  test('matches /admin/flows for sub-paths like /admin/flows/slug', () => {
    expect(isActive('/admin/flows', '/admin/flows/some-flow')).toBe(true);
  });

  test('does not match when path is prefix but not a complete segment', () => {
    expect(isActive('/admin/cat', '/admin/categories')).toBe(false);
  });

  test('matches /admin/site/appearance for /admin/site/appearance', () => {
    expect(isActive('/admin/site/appearance', '/admin/site/appearance')).toBe(true);
  });
});
