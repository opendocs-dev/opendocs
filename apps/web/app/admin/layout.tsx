import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { getSession, getMe } from '@/lib/server-api';
import { normalizeRole, menuFor, initials, roleLabel } from '@/lib/admin-nav';
import { AccountMenu } from './account-menu';
import { NavLinks } from './nav-links';
import { NavDrawer } from './nav-drawer';

import './admin.css';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getSession();

  if (!session) redirect('/sign-in?next=/admin');

  const me = await getMe();
  const role = normalizeRole(me?.role);
  const groups = menuFor(role);
  const userInitials = initials(session.user.name, session.user.email);
  const userName = session.user.name || session.user.email;
  const isTestSession = Boolean(session.user.email?.endsWith('@opendocs.test'));

  return (
    <div id="adm" className="adm">
      {isTestSession && (
        <div role="status" className="adm-test-banner">
          Test session (login bypass). Not a real account.
        </div>
      )}
      <header className="adm-topbar">
        <NavDrawer />
        <Link href="/admin" className="adm-nav-brand">
          OpenDocs
        </Link>
      </header>

      <aside id="adm-nav" className="adm-nav">
        <Link href="/admin" className="adm-nav-brand">
          OpenDocs
        </Link>

        <NavLinks groups={groups} />

        <AccountMenu
          name={userName}
          email={session.user.email}
          role={roleLabel(role)}
          workspace={me?.workspace.name}
          initials={userInitials}
        />
      </aside>

      <main className="adm-main">{children}</main>
    </div>
  );
}
