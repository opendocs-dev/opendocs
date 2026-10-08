import Link from 'next/link';
import { getAccount } from '@/lib/server-api';
import { AccountManager } from './account-manager';

export const metadata = { title: 'Account settings — OpenDocs' };

export default async function AccountPage() {
  const account = await getAccount();

  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      {!account ? (
        <>
          <div className="adm-pane-header">
            <div>
              <h1>Account settings</h1>
              <div className="sub">Your profile on this instance</div>
            </div>
          </div>
          <p role="alert">
            Could not load account settings. <Link href="/admin/account">Retry</Link>
          </p>
        </>
      ) : (
        <AccountManager account={account} />
      )}
    </div>
  );
}
