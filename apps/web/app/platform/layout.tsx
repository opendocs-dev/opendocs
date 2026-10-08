import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { getSession, getPlatformMe } from '@/lib/server-api';
import { initials } from '@/lib/admin-nav';
import { PlatformNav } from './platform-nav';
import { PlatformAccountMenu } from './platform-account-menu';

import '../dashboard/admin.css';

/**
 * Platform admin layout with indigo theme (.adm.platform) and prototype shell fidelity.
 */
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const session = await getSession();

  if (!session) redirect('/sign-in');

  const { staff, forbidden } = await getPlatformMe();

  if (forbidden || !staff) {
    return (
      <main className="container">
        <p role="alert">
          Platform staff access required. Ask an existing platform admin to add your account as staff.
        </p>
      </main>
    );
  }

  const userInitials = initials(session.user.name, session.user.email);
  const userName = session.user.name || session.user.email;

  return (
    <div id="adm" className="adm adm-platform platform">
      <aside id="adm-nav" className="adm-nav">
        <Link href="/platform" className="adm-nav-brand">
          <div className="adm-nav-brand-text">
            <span>OpenDocs</span>
            <small>Platform admin</small>
          </div>
        </Link>

        <PlatformNav />

        <PlatformAccountMenu
          name={userName}
          role={staff.role === 'support' ? 'Platform support' : 'Platform admin'}
          initials={userInitials}
        />
      </aside>

      <main className="adm-main">{children}</main>
    </div>
  );
}
