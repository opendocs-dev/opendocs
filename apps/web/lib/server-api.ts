import { headers } from 'next/headers';

const DEFAULT_API_ORIGIN = 'http://localhost:4000';

export type Session = {
  session: { activeOrganizationId?: string | null; [key: string]: unknown };
  user: { id: string; name?: string | null; email?: string | null };
};

export type Me = {
  workspace: { id: string; name: string; slug?: string };
  quota?: { files_left: number; bytes_left: number };
  min_cli_version: string;
  role?: string;
};

export type Overview = {
  published: number;
  unlisted: number;
  draft: number;
  uncategorized: number;
  suggested_categories: number;
  has_key: boolean;
  has_guide: boolean;
  views_30d?: number;
  searches?: number;
  storage_used?: string;
};

export type SiteInfo = {
  site_title: string;
  tagline: string;
  description: string;
  preset: string;
  accent?: string | null;
  mark?: string | null;
  font?: string | null;
  radius?: number | null;
  indexing: boolean;
  category_policy?: 'suggest' | 'auto';
  favicon_url: string | null;
  og_image_url: string | null;
};

export type FlowItem = {
  public_id: string;
  title: string;
  last_run_at: string;
  url: string | null;
  not_redacted: boolean;
  slug?: string;
  summary?: string;
  visibility?: 'published' | 'unlisted' | 'draft';
  steps?: number;
  category?: { id: string; name: string; status?: string } | null;
  seo_title?: string | null;
  seo_description?: string | null;
  noindex?: boolean;
  views?: number;
};

export type FlowsResponse = {
  items: FlowItem[];
  next_cursor: string | null;
};

export function apiOrigin(): string {
  return (process.env.API_ORIGIN ?? DEFAULT_API_ORIGIN).replace(/\/+$/, '');
}

/**
 * Server components reach the API directly, so the browser's session cookie
 * has to be forwarded by hand instead of relying on `credentials: "include"`.
 */
async function apiGet<T>(path: string): Promise<T | null> {
  const cookie = (await headers()).get('cookie') ?? '';

  const response = await fetch(`${apiOrigin()}${path}`, {
    headers: cookie ? { cookie } : {},
    cache: 'no-store',
  });

  if (!response.ok) return null;

  const body = (await response.json()) as T | null;

  return body ?? null;
}

/**
 * Same as `apiGet`, but keeps the status code so a caller can tell "forbidden"
 * (403, user is not a platform admin) apart from "empty" (200, nothing to show).
 */
export async function getSession(): Promise<Session | null> {
  const body = await apiGet<Session>('/api/auth/get-session');

  return body?.session ? body : null;
}

export function getMe(): Promise<Me | null> {
  return apiGet<Me>('/api/v1/me');
}

export function getFlows(cursor?: string): Promise<FlowsResponse | null> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';

  return apiGet<FlowsResponse>(`/api/v1/flows${query}`);
}

export function getOverview(): Promise<Overview | null> {
  return apiGet<Overview>('/api/v1/overview');
}

export function getSite(): Promise<SiteInfo | null> {
  return apiGet<SiteInfo>('/api/v1/site');
}

export async function getRecentFlows(
  limit: number = 4,
  visibility: string = 'published',
): Promise<FlowItem[] | null> {
  const response = await getGuideList({ limit, visibility });
  return response?.items ?? null;
}

export type AdminCategory = {
  id: string;
  slug: string;
  name: string;
  description?: string;
  status: 'active' | 'suggested';
  guides?: number;
};

export async function getGuideList(params: {
  q?: string;
  category?: string;
  visibility?: string;
  cursor?: string;
  limit?: number;
  public_id?: string;
}): Promise<FlowsResponse | null> {
  const search = new URLSearchParams();
  if (params.q) search.append('q', params.q);
  if (params.category) search.append('category', params.category);
  if (params.visibility) search.append('visibility', params.visibility);
  if (params.cursor) search.append('cursor', params.cursor);
  if (params.limit !== undefined) search.append('limit', String(params.limit));
  if (params.public_id) search.append('public_id', params.public_id);

  const query = search.toString();
  const path = `/api/v1/flows${query ? `?${query}` : ''}`;
  return apiGet<FlowsResponse>(path);
}

export async function getGuideById(publicId: string): Promise<FlowItem | null> {
  const response = await getGuideList({ public_id: publicId });
  return response?.items?.[0] ?? null;
}

export type AdminStep = {
  id: string;
  order: number;
  action: string;
  instruction: string;
  title: string | null;
  alt: string | null;
  page_url: string | null;
  selector: string | null;
  box: { x: number; y: number; w: number; h: number } | null;
  image: { url: string | null; width: number | null; height: number | null };
  redaction_mode?: string | null;
  redaction_report?: { count?: number; [key: string]: unknown } | null;
  masked_count?: number;
  hidden?: boolean;
};

export async function getGuideSteps(publicId: string): Promise<AdminStep[]> {
  const response = await apiGet<{ steps: AdminStep[] }>(`/api/v1/flows/${publicId}/steps`);
  return response?.steps ?? [];
}

export type FlowRun = {
  id: string;
  started_at: string;
  compiled_at: string | null;
  status: string;
  step_count: number;
  cli_version: string | null;
  is_current: boolean;
};

export async function getGuideRuns(publicId: string): Promise<FlowRun[]> {
  const response = await apiGet<{ runs: FlowRun[] }>(`/api/v1/flows/${publicId}/runs`);
  return response?.runs ?? [];
}

export type CategoriesResponse = {
  categories: AdminCategory[];
};

export async function getAdminCategories(): Promise<CategoriesResponse | null> {
  return apiGet<CategoriesResponse>('/api/v1/categories');
}

export type MemberItem = {
  id: string;
  user_id: string;
  name: string;
  email: string;
  image: string | null;
  role: 'owner' | 'admin' | 'editor';
  member_since: string;
  last_active_at?: string | null;
};
export type MembersResponse = {
  members: MemberItem[];
};
export function getMembers(): Promise<MembersResponse | null> {
  return apiGet<MembersResponse>('/api/v1/members');
}

export type AccountInfo = {
  name: string;
  email: string;
  image: string | null;
  email_notifications: boolean;
  notify_weekly_digest: boolean;
  github_handle?: string | null;
};
export function getAccount(): Promise<AccountInfo | null> {
  return apiGet<AccountInfo>('/api/v1/account');
}

export type ActivityLogEntry = {
  id: string;
  created_at: string;
  actor_kind: string;
  actor_id: string;
  actor_name: string;
  actor_email?: string | null;
  actor_image?: string | null;
  action: string;
  type: string;
  detail: Record<string, unknown>;
};

export type ActivityLogResponse = {
  activity_logs: ActivityLogEntry[];
  retention_days: number;
  can_export: boolean;
  next_cursor?: string | null;
  has_more?: boolean;
};

export async function getActivityLogs(params?: {
  person?: string;
  type?: string;
  cursor?: string;
  limit?: number;
  offset?: number;
}): Promise<ActivityLogResponse | null> {
  const searchParams = new URLSearchParams();
  if (params?.person) searchParams.set('person', params.person);
  if (params?.type) searchParams.set('type', params.type);
  if (params?.cursor) searchParams.set('cursor', params.cursor);
  if (params?.limit !== undefined) searchParams.set('limit', String(params.limit));
  if (params?.offset !== undefined) searchParams.set('offset', String(params.offset));
  const query = searchParams.toString();
  return apiGet<ActivityLogResponse>(`/api/v1/activity-log${query ? `?${query}` : ''}`);
}
export type AnalyticsData = {
  days: number;
  views: number;
  searches: number;
  searches_with_results_percent: number;
  marked_helpful_percent: number;
  views_per_day: Array<{
    day: string;
    views: number;
  }>;
  top_guides: Array<{
    id: string;
    public_id: string;
    title: string;
    slug: string | null;
    views: number;
  }>;
  top_searches: Array<{
    query: string;
    times: number;
    results: number;
  }>;
  searches_without_results: Array<{
    query: string;
    times: number;
  }>;
};

export function getAnalytics(days: number = 30): Promise<AnalyticsData | null> {
  return apiGet<AnalyticsData>(`/api/v1/analytics?days=${days}`);
}
