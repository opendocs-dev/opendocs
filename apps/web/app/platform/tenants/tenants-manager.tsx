'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { PlatformTenantItem } from '@/lib/server-api';
import { formatStorageGiB } from '@/lib/tenant-format';

type Props = {
  initialTenants: PlatformTenantItem[];
  total: number;
  currentPage: number;
  totalPages: number;
  initialQuery?: string;
  initialPlan?: string;
};

export function TenantsManager({
  initialTenants,
  total,
  currentPage,
  totalPages,
  initialQuery = '',
  initialPlan = 'all',
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState(initialQuery);
  const [plan, setPlan] = useState(initialPlan);

  const applyFilters = (newQuery: string, newPlan: string, page = 1) => {
    const params = new URLSearchParams(searchParams ? searchParams.toString() : '');
    if (newQuery.trim()) {
      params.set('q', newQuery.trim());
    } else {
      params.delete('q');
    }

    if (newPlan && newPlan !== 'all') {
      params.set('plan', newPlan);
    } else {
      params.delete('plan');
    }

    if (page > 1) {
      params.set('page', String(page));
    } else {
      params.delete('page');
    }

    startTransition(() => {
      const qStr = params.toString();
      router.push(`/platform/tenants${qStr ? `?${qStr}` : ''}`);
    });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    applyFilters(query, plan, 1);
  };

  const handlePlanChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedPlan = e.target.value;
    setPlan(selectedPlan);
    applyFilters(query, selectedPlan, 1);
  };

  const goToPage = (page: number) => {
    applyFilters(query, plan, page);
  };

  return (
    <div className="stack">
      {/* Pane Header with search and plan filter */}
      <div className="adm-pane-header">
        <div>
          <h1>Tenants</h1>
          <div className="sub">
            {initialTenants.length} of {total} shown
          </div>
        </div>

        <form
          onSubmit={handleSearchSubmit}
          style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}
        >
          <input
            type="search"
            placeholder="Search name or address"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: '240px' }}
            aria-label="Search name or address"
          />

          <select
            value={plan}
            onChange={handlePlanChange}
            style={{ width: '130px' }}
            aria-label="Filter by plan"
          >
            <option value="all">Any plan</option>
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>

          <button type="submit" className="btn" disabled={isPending}>
            Search
          </button>
        </form>
      </div>

      {/* Tenants Table */}
      <div className="card tw" style={{ padding: 0 }}>
        {initialTenants.length === 0 ? (
          <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--a-muted)' }}>
            No tenants found
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Address</th>
                <th>Plan</th>
                <th className="num">Guides</th>
                <th className="num">Storage</th>
                <th>Status</th>
                <th style={{ width: '80px', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {initialTenants.map((tenant) => {
                const isEnterprise = tenant.plan.toLowerCase() === 'enterprise';
                const isSuspended = tenant.status === 'suspended';

                return (
                  <tr key={tenant.id}>
                    <td>
                      <b>{tenant.name}</b>
                    </td>
                    <td>
                      <code>{tenant.address}</code>
                    </td>
                    <td>
                      <span className={`badge ${isEnterprise ? 'badge-ai' : ''}`}>
                        {tenant.plan.charAt(0).toUpperCase() + tenant.plan.slice(1)}
                      </span>
                    </td>
                    <td className="num">{tenant.guides_count}</td>
                    <td className="num">{formatStorageGiB(tenant.storage_bytes)}</td>
                    <td>
                      <span className={`badge ${isSuspended ? 'badge-bad' : 'badge-ok'}`}>
                        {isSuspended ? 'Suspended' : 'Active'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Link
                        href={`/platform/tenants/${tenant.slug}`}
                        className="btn"
                        style={{ padding: '3px 10px', fontSize: '13px' }}
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '8px',
          }}
        >
          <div className="sub">
            Page {currentPage} of {totalPages}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn"
              disabled={currentPage <= 1 || isPending}
              onClick={() => goToPage(currentPage - 1)}
            >
              Previous
            </button>
            <button
              type="button"
              className="btn"
              disabled={currentPage >= totalPages || isPending}
              onClick={() => goToPage(currentPage + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
