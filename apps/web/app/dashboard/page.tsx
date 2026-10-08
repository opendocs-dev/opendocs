import Link from 'next/link';

import { getMe, getOverview, getRecentFlows, getSite } from '@/lib/server-api';

import {
  formatBytesUsage,
  formatFilesUsage,
  quotaFor,
  usagePercent,
} from './usage-format';

export const metadata = { title: 'Overview — OpenDocs' };

export default async function DashboardPage() {
  const [me, overview, recentFlows, site] = await Promise.all([
    getMe(),
    getOverview(),
    getRecentFlows(4, 'published'),
    getSite(),
  ]);

  const quota = me ? quotaFor(me.plan) : null;
  const showUncategorizedCallout =
    overview && (overview.uncategorized > 0 || overview.suggested_categories > 0);
  const uncategorizedCount = overview?.uncategorized ?? 0;
  const hasSuggestions = (overview?.suggested_categories ?? 0) > 0;

  const workspaceName = me?.workspace.name || 'Workspace';
  const siteHost = me?.site_host || overview?.site_host || site?.address.host;

  // Checklist items (finding 4)
  const hasAddress = Boolean(siteHost);
  const hasAgent = Boolean(overview?.has_key);
  const hasFirstGuide = Boolean(overview && overview.published > 0);
  const hasLook = Boolean(
    site && (site.preset !== 'sage' || site.tagline || site.favicon_url || site.og_image_url)
  );
  const hasDomain = Boolean(site?.domain?.custom_domain);

  return (
    <div className="stack">
      {/* Page heading (finding 2) */}
      <div className="adm-pane-header">
        <div>
          <h1>Welcome back</h1>
          <div>
            {workspaceName}
            {siteHost ? ` is live at ${siteHost}` : ''}
          </div>
        </div>
        <div className="adm-buttons">
          {siteHost ? (
            <a
              href={`https://${siteHost}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn"
            >
              View site
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4.5 1.5H1.5v9h9V7.5M6 6l4.5-4.5M6.5 1.5h4v4" />
              </svg>
            </a>
          ) : (
            <Link href="/dashboard/site" className="btn">
              View site
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4.5 1.5H1.5v9h9V7.5M6 6l4.5-4.5M6.5 1.5h4v4" />
              </svg>
            </Link>
          )}
          <Link href="/dashboard/guides/new" className="btn btn-primary">
            + New guide
          </Link>
        </div>
      </div>

      {/* Uncategorized guides callout (findings 9, 10) */}
      {showUncategorizedCallout && (
        <div className="callout warn">
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 2.5L1.5 17.5h17L10 2.5z" />
            <path d="M10 7.5v4" />
            <path d="M10 14.5v.5" />
          </svg>
          <span className="sp">
            <b>
              {uncategorizedCount === 1
                ? '1 guide has no category.'
                : `${uncategorizedCount} guides have no category.`}
            </b>
            {hasSuggestions
              ? ' Your agent suggested categories for all of them.'
              : ''}
          </span>
          <Link
            href={hasSuggestions ? '/dashboard/categories' : '/dashboard/guides?category=none'}
            className="btn"
          >
            {hasSuggestions ? 'Review suggestions' : 'Review guides'}
          </Link>
        </div>
      )}

      {/* Stats counters (C14-AC07) */}
      {overview ? (
        <div className="grid4">
          <div className="stat">
            <b>{overview.published}</b>
            <span>Published guides</span>
          </div>
          <div className="stat">
            <b>{(overview.views_30d ?? 0).toLocaleString()}</b>
            <span>Views, last 30 days</span>
          </div>
          <div className="stat">
            <b>{(overview.searches ?? 0).toLocaleString()}</b>
            <span>Searches</span>
          </div>
          <div className="stat">
            <b>{overview.storage_used ?? '0%'}</b>
            <span>Storage used</span>
          </div>
        </div>
      ) : (
        <p role="alert">Could not load overview. Refresh the page to try again.</p>
      )}

      {/* Recently published and setup checklist (findings 1, 3, 4) */}
      <div className="split">
        {/* Recently published */}
        <div className="card">
          <h3>Recently published</h3>
          {recentFlows === null ? (
            <p role="alert">
              Could not load recent guides. <Link href="/dashboard">Retry</Link>
            </p>
          ) : recentFlows.length > 0 ? (
            <div className="tw">
              <table>
                <tbody>
                  {recentFlows.map((flow) => {
                    const isPublished = flow.visibility === 'published';
                    const href =
                      isPublished && siteHost && flow.slug
                        ? `https://${siteHost}/g/${flow.slug}`
                        : flow.url;

                    return (
                      <tr key={flow.public_id}>
                        <td>
                          <b>
                            {href ? (
                              <a href={href} target="_blank" rel="noopener noreferrer">
                                {flow.title}
                              </a>
                            ) : (
                              flow.title
                            )}
                          </b>
                          <br />
                          <span className="sub">
                            {flow.category?.name || 'Uncategorized'}
                          </span>
                        </td>
                        <td className="num">{(flow.views ?? 0).toLocaleString()} views</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="sub">No guides yet. Create one to get started.</p>
          )}
        </div>

        {/* Setup checklist */}
        <div className="card">
          <h3>Set up your site</h3>
          <ul className="check">
            <li className={hasAddress ? 'done' : ''}>
              <span className="tick">
                {hasAddress && (
                  <svg
                    width="12"
                    height="10"
                    viewBox="0 0 12 10"
                    fill="currentColor"
                  >
                    <path d="M10.6 0.6L4 7.2L1.4 4.6" stroke="currentColor" strokeWidth="1.5" fill="none" />
                  </svg>
                )}
              </span>
              <span>
                {hasAddress ? (
                  'Claim your address'
                ) : (
                  <Link href="/dashboard/site">Claim your address</Link>
                )}
              </span>
            </li>
            <li className={hasAgent ? 'done' : ''}>
              <span className="tick">
                {hasAgent && (
                  <svg
                    width="12"
                    height="10"
                    viewBox="0 0 12 10"
                    fill="currentColor"
                  >
                    <path d="M10.6 0.6L4 7.2L1.4 4.6" stroke="currentColor" strokeWidth="1.5" fill="none" />
                  </svg>
                )}
              </span>
              <span>
                {hasAgent ? (
                  'Connect an AI agent'
                ) : (
                  <Link href="/dashboard/keys">Connect an AI agent</Link>
                )}
              </span>
            </li>
            <li className={hasFirstGuide ? 'done' : ''}>
              <span className="tick">
                {hasFirstGuide && (
                  <svg
                    width="12"
                    height="10"
                    viewBox="0 0 12 10"
                    fill="currentColor"
                  >
                    <path d="M10.6 0.6L4 7.2L1.4 4.6" stroke="currentColor" strokeWidth="1.5" fill="none" />
                  </svg>
                )}
              </span>
              <span>
                {hasFirstGuide ? (
                  'Publish your first guide'
                ) : (
                  <Link href="/dashboard/guides/new">Publish your first guide</Link>
                )}
              </span>
            </li>
            <li className={hasLook ? 'done' : ''}>
              <span className="tick">
                {hasLook && (
                  <svg
                    width="12"
                    height="10"
                    viewBox="0 0 12 10"
                    fill="currentColor"
                  >
                    <path d="M10.6 0.6L4 7.2L1.4 4.6" stroke="currentColor" strokeWidth="1.5" fill="none" />
                  </svg>
                )}
              </span>
              <span>
                {hasLook ? (
                  'Choose a look for your site'
                ) : (
                  <Link href="/dashboard/site/appearance">Choose a look for your site</Link>
                )}
              </span>
            </li>
            <li className={hasDomain ? 'done' : ''}>
              <span className="tick">
                {hasDomain && (
                  <svg
                    width="12"
                    height="10"
                    viewBox="0 0 12 10"
                    fill="currentColor"
                  >
                    <path d="M10.6 0.6L4 7.2L1.4 4.6" stroke="currentColor" strokeWidth="1.5" fill="none" />
                  </svg>
                )}
              </span>
              <span>
                {hasDomain ? (
                  'Connect your own domain'
                ) : (
                  <Link href="/dashboard/site">Connect your own domain</Link>
                )}
              </span>
            </li>
          </ul>
        </div>
      </div>

      {/* Usage card */}
      <div className="card">
        <h3>Usage today</h3>
        {me && quota ? (
          <>
            <p>{formatFilesUsage(me.quota.files_left, quota.files)}</p>
            <div
              className="bar"
              role="progressbar"
              aria-label="Files used today"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={usagePercent(me.quota.files_left, quota.files)}
            >
              <div
                className="bar-fill"
                style={{ width: `${usagePercent(me.quota.files_left, quota.files)}%` }}
              />
            </div>
            <p className="muted">{formatBytesUsage(me.quota.bytes_left, quota.bytes)}</p>
          </>
        ) : (
          <p role="alert">
            Could not load usage. <Link href="/dashboard">Retry</Link>
          </p>
        )}
      </div>
    </div>
  );
}
