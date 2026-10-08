import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBilling, getMe } from '@/lib/server-api';
import { normalizeRole } from '@/lib/admin-nav';
import { BillingManager } from './billing-manager';

export const metadata = { title: 'Billing — OpenDocs' };

export default async function BillingPage() {
  if (process.env.BILLING_READY !== 'true') {
    notFound();
  }

  const [billing, me] = await Promise.all([getBilling(), getMe()]);
  const role = normalizeRole(me?.role);

  if (role !== 'owner') {
    return (
      <div className="stack">
        <div className="adm-pane-header">
          <div>
            <h1>Billing</h1>
            <div style={{ color: 'var(--a-muted)', fontSize: 13 }}>Only owners can see this page</div>
          </div>
        </div>
        <p role="alert">Only workspace owners can view or manage billing.</p>
      </div>
    );
  }

  if (!billing) {
    return (
      <div className="stack">
        <div className="adm-pane-header">
          <div>
            <h1>Billing</h1>
            <div style={{ color: 'var(--a-muted)', fontSize: 13 }}>Only owners can see this page</div>
          </div>
        </div>
        <p role="alert">
          Could not load billing information. <Link href="/dashboard/billing">Retry</Link>
        </p>
      </div>
    );
  }

  return <BillingManager initialBilling={billing} />;
}
