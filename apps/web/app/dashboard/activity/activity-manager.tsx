'use client';

import { useState } from 'react';
import type { ActivityLogEntry } from '@/lib/server-api';
import { initials } from '@/lib/admin-nav';
import { formatAuditTime } from '@/lib/audit-time';

type Props = {
  initialLogs: ActivityLogEntry[];
  retentionDays: number;
  canExport: boolean;
  initialNextCursor?: string | null;
  initialHasMore?: boolean;
};

export function ActivityManager({
  initialLogs,
  retentionDays,
  canExport,
  initialNextCursor,
  initialHasMore,
}: Props) {
  const [logs, setLogs] = useState<ActivityLogEntry[]>(initialLogs);
  const [selectedPerson, setSelectedPerson] = useState('all');
  const [selectedType, setSelectedType] = useState('all');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const startingHasMore =
    initialHasMore !== undefined
      ? initialHasMore
      : initialNextCursor !== undefined
        ? Boolean(initialNextCursor)
        : initialLogs.length >= 50;

  const startingCursor =
    initialNextCursor !== undefined
      ? initialNextCursor
      : startingHasMore && initialLogs.length > 0
        ? initialLogs[initialLogs.length - 1].id
        : null;

  const [nextCursor, setNextCursor] = useState<string | null>(startingCursor);
  const [hasMore, setHasMore] = useState<boolean>(startingHasMore);

  // Extract distinct people for filter
  const distinctPeople = Array.from(
    new Map(
      logs
        .filter((l) => l.actor_kind === 'user' && l.actor_id)
        .map((l) => [l.actor_id, l.actor_name || l.actor_email || 'User']),
    ).entries(),
  );

  const fetchFilteredLogs = async (person: string, type: string) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (person !== 'all') params.set('person', person);
      if (type !== 'all') params.set('type', type);
      const query = params.toString();

      const res = await fetch(`/api/v1/activity-log${query ? `?${query}` : ''}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.activity_logs);
        setNextCursor(data.next_cursor ?? null);
        setHasMore(data.has_more ?? Boolean(data.next_cursor));
      }
    } catch (err) {
      console.error('Failed to filter activity logs:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadMore = async () => {
    if (!hasMore || isLoadingMore || !nextCursor) return;
    setIsLoadingMore(true);
    try {
      const params = new URLSearchParams();
      if (selectedPerson !== 'all') params.set('person', selectedPerson);
      if (selectedType !== 'all') params.set('type', selectedType);
      params.set('cursor', nextCursor);
      const query = params.toString();

      const res = await fetch(`/api/v1/activity-log?${query}`);
      if (res.ok) {
        const data = await res.json();
        setLogs((prev) => [...prev, ...data.activity_logs]);
        setNextCursor(data.next_cursor ?? null);
        setHasMore(data.has_more ?? Boolean(data.next_cursor));
      }
    } catch (err) {
      console.error('Failed to load more activity logs:', err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handlePersonChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedPerson(val);
    fetchFilteredLogs(val, selectedType);
  };

  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedType(val);
    fetchFilteredLogs(selectedPerson, val);
  };

  return (
    <div className="stack" style={{ gap: '12px' }}>
      <div className="adm-pane-header" style={{ marginBottom: 0 }}>
        <div>
          <h1>Activity log</h1>
          <div>Last {retentionDays} days</div>
        </div>
        <div>
          {canExport ? (
            <a
              href="/api/v1/activity-log/export"
              download="activity-log.csv"
              className="btn"
            >
              Export CSV
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4.5 1.5H1.5v9h9V7.5M6 6l4.5-4.5M6.5 1.5h4v4" />
              </svg>
            </a>
          ) : (
            <button
              type="button"
              className="btn"
              disabled
              title="Export CSV is available on Enterprise plan"
            >
              Export CSV <span className="badge badge-ai">Enterprise</span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4.5 1.5H1.5v9h9V7.5M6 6l4.5-4.5M6.5 1.5h4v4" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="btns">
        <select
          id="filter-person"
          aria-label="Person"
          value={selectedPerson}
          onChange={handlePersonChange}
          style={{ width: 'auto' }}
        >
          <option value="all">Everyone</option>
          {distinctPeople.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
          <option value="apikey">API keys</option>
        </select>

        <select
          id="filter-type"
          aria-label="Type"
          value={selectedType}
          onChange={handleTypeChange}
          style={{ width: 'auto' }}
        >
          <option value="all">All changes</option>
          <option value="guides">Guides</option>
          <option value="site">Site settings</option>
          <option value="members">Members</option>
          <option value="keys">Keys and billing</option>
        </select>
      </div>

      <div className="card tw" style={{ padding: '4px 8px' }}>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={3} style={{ textAlign: 'center', padding: '24px', color: 'var(--a-muted)' }}>
                  Loading activity...
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ textAlign: 'center', padding: '24px', color: 'var(--a-muted)' }}>
                  No activity recorded in the last {retentionDays} days.
                </td>
              </tr>
            ) : (
              logs.map((row) => (
                <tr key={row.id}>
                  <td style={{ whiteSpace: 'nowrap' }} title={new Date(row.created_at).toISOString()}>
                    {formatAuditTime(row.created_at)}
                  </td>
                  <td>
                    <span className="pp">
                      {row.actor_kind === 'apikey' ? (
                        <span className="av">⌁</span>
                      ) : (
                        <span className="av">{initials(row.actor_name, row.actor_email)}</span>
                      )}
                      <span>
                        <b>{row.actor_name}</b>
                        {row.actor_email && row.actor_name !== row.actor_email && (
                          <span className="muted" style={{ marginLeft: '6px' }}>
                            {row.actor_email}
                          </span>
                        )}
                      </span>
                    </span>
                  </td>
                  <td>{row.action}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button
            type="button"
            className="btn"
            onClick={handleLoadMore}
            disabled={isLoadingMore}
            aria-label="Load more activity"
          >
            {isLoadingMore ? 'Loading...' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
