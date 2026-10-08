import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { getSession, getMe, getWorkspaces } from '@/lib/server-api';
import { normalizeRole, menuFor, initials, roleLabel } from '@/lib/admin-nav';
import { AccountMenu } from './account-menu';
import { NavLinks } from './nav-links';
import { NavDrawer } from './nav-drawer';

import './admin.css';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getSession();

  if (!session) redirect('/sign-in');

  const hasWorkspace = Boolean(session.session.activeOrganizationId);

  if (!hasWorkspace) {
    return (
      <main className="container">
        <p role="alert">No workspace found — try signing in again</p>
      </main>
    );
  }

  const [me, workspaces] = await Promise.all([getMe(), getWorkspaces()]);
  const role = normalizeRole(me?.role);
  const groups = menuFor(role, process.env.BILLING_READY === 'true');
  const userInitials = initials(session.user.name, session.user.email);
  const userName = session.user.name || session.user.email;
  const isTestSession = Boolean(session.user.email?.endsWith('@opendocs.test'));

  const workspaceList =
    workspaces && workspaces.length > 0
      ? workspaces
      : me?.workspace
        ? [{ id: me.workspace.id, name: me.workspace.name, slug: me.workspace.slug }]
        : [];

  return (
    <div id="adm" className="adm">
      {isTestSession && (
        <div role="status" className="adm-test-banner">
          Test session (login bypass). Not a real account.
        </div>
      )}
      <header className="adm-topbar">
        <NavDrawer />
        <Link href="/dashboard" className="adm-nav-brand">
          OpenDocs
        </Link>
      </header>

      <aside id="adm-nav" className="adm-nav">
        <Link href="/dashboard" className="adm-nav-brand">
          OpenDocs
        </Link>

        <NavLinks groups={groups} />

        <AccountMenu
          name={userName}
          email={session.user.email}
          role={roleLabel(role)}
          workspace={me?.workspace.name}
          activeWorkspaceId={session.session.activeOrganizationId}
          workspaces={workspaceList}
          initials={userInitials}
        />
      </aside>

      <main className="adm-main">{children}</main>
    </div>
  );
}
