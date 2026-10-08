'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type MenuGroup, isActive } from '@/lib/admin-nav';

interface NavLinksProps {
  groups: MenuGroup[];
}

export function NavLinks({ groups }: NavLinksProps) {
  const pathname = usePathname();

  return (
    <>
      {groups.map((group) => (
        <div key={group.label}>
          <div className="adm-nav-group">{group.label}</div>
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={isActive(item.href, pathname) ? 'active' : ''}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </>
  );
}
