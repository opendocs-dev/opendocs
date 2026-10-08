import Link from 'next/link';
import { getPlatformTenants } from '@/lib/server-api';
import { TenantsManager } from './tenants-manager';

export const metadata = { title: 'Tenants — OpenDocs' };

export default async function PlatformTenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; plan?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = params.page ? Math.max(1, parseInt(params.page, 10) || 1) : 1;
  const q = params.q || '';
  const plan = params.plan || 'all';

  const { data, forbidden } = await getPlatformTenants({
    q,
    plan,
    page,
    limit: 20,
  });

  if (forbidden) {
    return (
      <div className="stack">
        <p role="alert">
          Platform staff access required. Ask an existing platform admin to add your account as staff.
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="stack">
        <p role="alert">
          Could not load tenants list. <Link href="/platform/tenants">Retry</Link>
        </p>
      </div>
    );
  }

  return (
    <TenantsManager
      initialTenants={data.tenants}
      total={data.total}
      currentPage={data.page}
      totalPages={data.total_pages}
      initialQuery={q}
      initialPlan={plan}
    />
  );
}
