import Link from 'next/link';
import { getAccount, getMe } from '@/lib/server-api';
import { normalizeRole } from '@/lib/admin-nav';
import { AccountManager } from './account-manager';

export const metadata = { title: 'Account settings — OpenDocs' };

export default async function AccountPage() {
  const [account, me] = await Promise.all([getAccount(), getMe()]);

  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      {!account ? (
        <>
          <div className="adm-pane-header">
            <div>
              <h1>Account settings</h1>
              <div className="sub">Applies to you in every workspace</div>
            </div>
          </div>
          <p role="alert">
            Could not load account settings. <Link href="/dashboard/account">Retry</Link>
          </p>
        </>
      ) : (
        <AccountManager
          account={account}
          currentUserRole={normalizeRole(me?.role)}
          organizationId={me?.workspace.id ?? null}
          workspaceName={me?.workspace.name ?? 'workspace'}
        />
      )}
    </div>
  );
}
