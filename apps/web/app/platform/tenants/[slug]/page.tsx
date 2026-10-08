import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPlatformMe, getPlatformTenant } from '@/lib/server-api';
import { TenantDetailClient } from './tenant-detail-client';

export const metadata = { title: 'Tenant details — OpenDocs' };

export default async function PlatformTenantDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [{ tenant, forbidden, notFound: isNotFound }, { staff }] = await Promise.all([
    getPlatformTenant(slug),
    getPlatformMe(),
  ]);

  if (forbidden) {
    return (
      <div className="stack">
        <p role="alert">
          Platform staff access required. Ask an existing platform admin to add your account as staff.
        </p>
      </div>
    );
  }

  if (isNotFound || !tenant) {
    return (
      <div className="stack">
        <p role="alert">
          Tenant not found. <Link href="/platform/tenants">Return to tenants list</Link>
        </p>
      </div>
    );
  }

  return (
    <TenantDetailClient
      initialTenant={tenant}
      currentRole={staff?.role ?? 'support'}
    />
  );
}
