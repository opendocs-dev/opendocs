import type { Metadata } from 'next';
import Link from 'next/link';
import { getAnalytics } from '@/lib/server-api';
import { ViewsChart } from './views-chart';

export const metadata: Metadata = {
  title: 'Analytics — OpenDocs',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatRangeText(days: number, viewsPerDay: Array<{ day: string }>): string {
  if (viewsPerDay.length === 0) return `Last ${days} days`;
  const first = viewsPerDay[0]?.day.split('-');
  const last = viewsPerDay[viewsPerDay.length - 1]?.day.split('-');
  if (!first || !last || first.length < 3 || last.length < 3) return `Last ${days} days`;

  const m1 = MONTHS[parseInt(first[1] ?? '1', 10) - 1] ?? '';
  const d1 = parseInt(first[2] ?? '1', 10);
  const y1 = first[0];

  const m2 = MONTHS[parseInt(last[1] ?? '1', 10) - 1] ?? '';
  const d2 = parseInt(last[2] ?? '1', 10);
  const y2 = last[0];

  if (y1 === y2) {
    return `${m1} ${d1} to ${m2} ${d2}, ${y2}`;
  }
  return `${m1} ${d1}, ${y1} to ${m2} ${d2}, ${y2}`;
}

type PageProps = {
  searchParams: Promise<{ days?: string }>;
};

export default async function AnalyticsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rawDays = Number(params.days);
  const days = rawDays === 7 || rawDays === 90 ? rawDays : 30;

  const data = await getAnalytics(days);

  if (!data) {
    return (
      <div className="stack">
        <div className="adm-pane-header">
          <div>
            <h1>Analytics</h1>
          </div>
        </div>
        <p role="alert">Could not load analytics. Refresh the page to try again.</p>
      </div>
    );
  }

  const rangeSubtitle = formatRangeText(days, data.views_per_day);

  return (
    <div className="stack">
      <div className="adm-pane-header">
        <div>
          <h1>Analytics</h1>
          <div>{rangeSubtitle}</div>
        </div>
        <span className="seg" aria-label="Select date range">
          <Link
            href="/dashboard/analytics?days=7"
            aria-current={days === 7 ? 'page' : undefined}
          >
            7 days
          </Link>
          <Link
            href="/dashboard/analytics?days=30"
            aria-current={days === 30 ? 'page' : undefined}
          >
            30 days
          </Link>
          <Link
            href="/dashboard/analytics?days=90"
            aria-current={days === 90 ? 'page' : undefined}
          >
            90 days
          </Link>
        </span>
      </div>

      {/* Grid4 stats (C14-AC29) */}
      <div className="grid4">
        <div className="stat">
          <b>{data.views.toLocaleString()}</b>
          <span>Guide views</span>
        </div>
        <div className="stat">
          <b>{data.searches.toLocaleString()}</b>
          <span>Searches</span>
        </div>
        <div className="stat">
          <b>{data.searches_with_results_percent}%</b>
          <span>Searches with results</span>
        </div>
        <div className="stat">
          <b>{data.marked_helpful_percent}%</b>
          <span>Marked helpful</span>
        </div>
      </div>

      {/* Views per day chart */}
      <div className="card">
        <h3>Views per day</h3>
        <ViewsChart data={data.views_per_day} />
      </div>

      {/* Top guides & Searches with no results */}
      <div className="grid2">
        <div className="card tw">
          <h3>Top guides</h3>
          {data.top_guides.length === 0 ? (
            <p className="muted" style={{ padding: '12px 16px' }}>No guide views recorded yet</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Guide</th>
                  <th className="num">Views</th>
                </tr>
              </thead>
              <tbody>
                {data.top_guides.map((guide) => (
                  <tr key={guide.id}>
                    <td>
                      <Link
                        href={`/dashboard/guides/${guide.public_id || guide.id}`}
                        style={{ color: 'inherit', textDecoration: 'none' }}
                      >
                        {guide.title}
                      </Link>
                    </td>
                    <td className="num">{guide.views.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card tw">
          <h3>Searches with no results</h3>
          {data.searches_without_results.length === 0 ? (
            <p className="muted" style={{ padding: '12px 16px' }}>No zero-result searches</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Search</th>
                  <th className="num">Times</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.searches_without_results.map((search) => (
                  <tr key={search.query}>
                    <td>{search.query}</td>
                    <td className="num">{search.times.toLocaleString()}</td>
                    <td>
                      <Link
                        href={`/dashboard/guides/new?task=${encodeURIComponent(search.query)}`}
                        className="btn"
                      >
                        Record a guide
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Top searches */}
      <div className="card tw">
        <h3>Top searches</h3>
        {data.top_searches.length === 0 ? (
          <p className="muted" style={{ padding: '12px 16px' }}>No searches recorded yet</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Search</th>
                <th className="num">Times</th>
                <th className="num">Results</th>
              </tr>
            </thead>
            <tbody>
              {data.top_searches.map((search) => (
                <tr key={search.query}>
                  <td>{search.query}</td>
                  <td className="num">{search.times.toLocaleString()}</td>
                  <td className="num">{search.results.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
