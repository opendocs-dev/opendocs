export type Role = 'owner' | 'admin' | 'editor';

/** Toggle to enable the Categories menu item. */
export const CATEGORIES_READY = true;

/** Toggle to enable the Activity log menu item. */
export const ACTIVITY_READY = true;

/**
 * Normalizes a role from the API, handling undefined, null, 'member' and unknown values.
 * Falls back to 'editor' for unrecognized roles.
 */
export function normalizeRole(raw: string | undefined | null): Role {
  if (!raw || raw === 'member') return 'editor';
  if (raw === 'owner' || raw === 'admin' || raw === 'editor') return raw;
  return 'editor';
}

/**
 * Returns the role label for display.
 */
export function roleLabel(role: Role): string {
  switch (role) {
    case 'owner':
      return 'Owner';
    case 'admin':
      return 'Admin';
    case 'editor':
      return 'Editor';
  }
}

/**
 * Returns initials from a name or email.
 * Takes first letters of up to two words, falls back to first letter of email, then '?'.
 */
export function initials(name: string | null | undefined, email?: string | null): string {
  if (name) {
    const words = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (words.length > 0) {
      return words.map((w) => w[0].toUpperCase()).join('');
    }
  }

  if (email) {
    return email[0].toUpperCase();
  }

  return '?';
}

export interface MenuItem {
  href: string;
  label: string;
}

export interface MenuGroup {
  label: string;
  items: MenuItem[];
}

/**
 * Builds the menu structure based on the user's role.
 * Omits groups with no items.
 */
export function menuFor(role: Role): MenuGroup[] {
  const groups: MenuGroup[] = [];

  // Content group (available to all roles)
  const contentItems: MenuItem[] = [
    { href: '/admin', label: 'Overview' },
    { href: '/admin/guides', label: 'Guides' },
  ];

  if (CATEGORIES_READY) {
    contentItems.push({ href: '/admin/categories', label: 'Categories' });
  }
  contentItems.push({ href: '/admin/analytics', label: 'Analytics' });

  groups.push({ label: 'Content', items: contentItems });

  // Site group (owner and admin only)
  if (role === 'owner' || role === 'admin') {
    groups.push({
      label: 'Site',
      items: [
        { href: '/admin/site/appearance', label: 'Appearance' },
        { href: '/admin/site/seo', label: 'SEO' },
      ],
    });
  }

  // Workspace group (owner and admin only)
  if (role === 'owner' || role === 'admin') {
    const workspaceItems: MenuItem[] = [
      { href: '/admin/members', label: 'Members' },
      { href: '/admin/keys', label: 'API and MCP' },
    ];
    if (ACTIVITY_READY) {
      workspaceItems.push({ href: '/admin/activity', label: 'Activity log' });
    }
    groups.push({ label: 'Workspace', items: workspaceItems });
  }

  return groups;
}

/**
 * Checks if a link is active relative to the current pathname.
 * '/admin' and '/admin/site' match exactly so sibling site sections
 * (/admin/site/appearance, /admin/site/seo) do not both highlight.
 * Other paths match the path and its sub-paths.
 */
export function isActive(href: string, pathname: string): boolean {
  if (href === '/admin') {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
