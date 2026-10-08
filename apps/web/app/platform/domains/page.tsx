import Link from 'next/link';
import { getPlatformDomains, getPlatformMe } from '@/lib/server-api';
import { DomainsManager } from './domains-manager';

export const metadata = { title: 'Domains — OpenDocs' };

export default async function PlatformDomainsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const params = await searchParams;
  const filter = params.filter || 'all';

  const [{ data, forbidden }, { staff }] = await Promise.all([
    getPlatformDomains(filter),
    getPlatformMe(),
  ]);

  if (forbidden || !staff) {
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
          Could not load custom domains. <Link href="/platform/domains">Retry</Link>
        </p>
      </div>
    );
  }

  return (
    <DomainsManager
      initialDomains={data.domains}
      total={data.total}
      initialFilter={filter}
      currentRole={staff.role}
    />
  );
}
