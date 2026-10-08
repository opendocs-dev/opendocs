'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  {
    href: '/platform/tenants',
    label: 'Tenants',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="2" width="12" height="12" rx="2" />
        <path d="M6 6h.01M10 6h.01M6 9h.01M10 9h.01M7 14v-2h2v2" />
      </svg>
    ),
  },
  {
    href: '/platform/ai/models',
    label: 'AI models',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 1.5l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5 1.5-4z" />
      </svg>
    ),
  },
  {
    href: '/platform/ai/credits',
    label: 'Credits and limits',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="3" width="12" height="10" rx="2" />
        <path d="M2 7h12M5 10h2" />
      </svg>
    ),
  },
  {
    href: '/platform/domains',
    label: 'Domains',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="8" cy="8" r="6" />
        <path d="M2 8h12M8 2a10 10 0 0 1 0 12M8 2a10 10 0 0 0 0 12" />
      </svg>
    ),
  },
  {
    href: '/platform/reports',
    label: 'Reports',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 13V9M7 13V5M11 13V7M15 13H1" />
      </svg>
    ),
  },
  {
    href: '/platform/reserved-names',
    label: 'Reserved names',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 3h10v11l-5-3-5 3V3z" />
      </svg>
    ),
  },
  {
    href: '/platform/staff',
    label: 'Staff and audit',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 14a6 6 0 0 1 12 0" />
      </svg>
    ),
  },
];

function isActive(href: string, pathname: string): boolean {
  if (pathname === href) return true;
  if (href !== '/platform' && pathname.startsWith(href + '/')) return true;
  return false;
}

export function PlatformNav() {
  const pathname = usePathname();

  return (
    <nav className="stack" style={{ gap: 2 }}>
      {NAV_ITEMS.map((item) => {
        const active = isActive(item.href, pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? 'active' : ''}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
