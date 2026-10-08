import { headers } from 'next/headers';

const DEFAULT_API_ORIGIN = 'http://localhost:4000';

export type Session = {
  session: { activeOrganizationId?: string | null; [key: string]: unknown };
  user: { id: string; name?: string | null; email?: string | null };
};

export type Me = {
  workspace: { id: string; name: string; slug?: string };
  plan: string;
  quota: { files_left: number; bytes_left: number };
  min_cli_version: string;
  role?: string;
  site_host?: string | null;
};

export type Overview = {
  published: number;
  unlisted: number;
  draft: number;
  uncategorized: number;
  suggested_categories: number;
  has_key: boolean;
  has_guide: boolean;
  site_host: string | null;
  views_30d?: number;
  searches?: number;
  storage_used?: string;
};

export type CustomMetaTag = { name: string; content: string };

export type SiteInfo = {
  address: { slug: string; host: string | null };
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
  custom_meta: CustomMetaTag[];
  domain: {
    custom_domain: string | null;
    status: 'verified' | 'waiting_dns' | 'cert_failing' | 'blocked' | null;
    cname_target: string;
    cert_expires_at: string | null;
    last_checked_at: string | null;
  };
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
async function apiGetStatus<T>(path: string): Promise<{ status: number; body: T | null }> {
  const cookie = (await headers()).get('cookie') ?? '';

  const response = await fetch(`${apiOrigin()}${path}`, {
    headers: cookie ? { cookie } : {},
    cache: 'no-store',
  });

  if (!response.ok) return { status: response.status, body: null };

  const body = (await response.json()) as T | null;

  return { status: response.status, body: body ?? null };
}

export async function getSession(): Promise<Session | null> {
  const body = await apiGet<Session>('/api/auth/get-session');

  return body?.session ? body : null;
}

export type WorkspaceItem = {
  id: string;
  name: string;
  slug?: string;
};

export async function getWorkspaces(): Promise<WorkspaceItem[]> {
  const list = await apiGet<WorkspaceItem[]>('/api/auth/organization/list');
  return list ?? [];
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

export type ReservedName = {
  name: string;
  reason: string;
};

export type ReservedNamesResponse = {
  reserved_names: ReservedName[];
};

/**
 * Loads the reserved-names list for the platform admin screen. `forbidden` is true when
 * the signed-in user is not on the `PLATFORM_ADMIN_EMAILS` allow-list (403); the layout
 * uses that to show an access-denied message instead of an empty table.
 */
export async function getPlatformReservedNames(): Promise<{
  reservedNames: ReservedName[] | null;
  forbidden: boolean;
}> {
  const { status, body } = await apiGetStatus<ReservedNamesResponse>('/api/v1/platform/reserved-names');

  return { reservedNames: body?.reserved_names ?? null, forbidden: status === 403 };
}

export type PlatformAiModel = {
  id: string;
  provider: string;
  modelId: string;
  name: string;
  label: string;
  creditsPerReply: number;
  plans: string[];
  status: string;
  isDefault: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type PlatformAiProvider = {
  provider: string;
  baseUrl: string | null;
  status: string;
  hasSecret: boolean;
  maskedSecret: string;
  lastTestedAt: string | null;
  updatedAt?: string;
};

export type PlatformAiSettings = {
  id: string;
  aiEnabled: boolean;
  spendCapMonthly: number;
  currentMonthSpend: number;
  alertPercent: number;
  pauseAtCap: boolean;
  creditOverageAction?: string;
  chargeOnlyWhenDelivered?: boolean;
  updatedAt?: string;
};

export type PlatformPlanConfig = {
  plan: string;
  monthlyCredits: number;
  byokAllowed: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export async function getPlatformAiModels(): Promise<{
  models: PlatformAiModel[];
  providers: PlatformAiProvider[];
  forbidden: boolean;
}> {
  const { status, body: modelsBody } = await apiGetStatus<{ models: PlatformAiModel[] }>('/api/v1/platform/ai/models');
  if (status === 403) return { models: [], providers: [], forbidden: true };
  const { body: providersBody } = await apiGetStatus<{ providers: PlatformAiProvider[] }>('/api/v1/platform/ai/providers');
  return {
    models: modelsBody?.models ?? [],
    providers: providersBody?.providers ?? [],
    forbidden: false,
  };
}

export async function getPlatformAiLimits(): Promise<{
  settings: PlatformAiSettings | null;
  plans: PlatformPlanConfig[];
  forbidden: boolean;
}> {
  const { status, body: settingsBody } = await apiGetStatus<PlatformAiSettings>('/api/v1/platform/ai/settings');
  if (status === 403) return { settings: null, plans: [], forbidden: true };
  const { body: plansBody } = await apiGetStatus<{ plans: PlatformPlanConfig[] }>('/api/v1/platform/ai/plans');
  return {
    settings: settingsBody ?? null,
    plans: plansBody?.plans ?? [],
    forbidden: false,
  };
}

export type StorageConnectionInfo = {
  kind: string;
  config: Record<string, unknown>;
  status: 'connected' | 'failed' | 'untested';
  last_tested_at: string | null;
};
export type StorageUsage = {
  bytes_used: number;
  bytes_limit: number;
};
export type StorageInfo = {
  plan: string;
  allowed_kinds: string[];
  active_kind: string | null;
  connections: StorageConnectionInfo[];
  usage?: StorageUsage | null;
};
export function getStorage(): Promise<StorageInfo | null> {
  return apiGet<StorageInfo>('/api/v1/storage');
}

export type PlanCapabilities = {
  presetCount: number;
  customPreset: boolean;
  storageKinds: ('gdrive' | 's3')[];
  footerCredit: boolean;
  aiAssistant: boolean;
  customDomain: boolean;
};
export type PlanMatrixEntry = {
  plan: string;
  quota: { files: number; bytes: number };
  capabilities: PlanCapabilities;
};
export type PlanInfo = {
  plan: string;
  quota: { files_left: number; bytes_left: number };
  plans: PlanMatrixEntry[];
};
export function getPlanInfo(): Promise<PlanInfo | null> {
  return apiGet<PlanInfo>('/api/v1/plan');
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
export type PendingInvitation = {
  id: string;
  email: string;
  role: 'owner' | 'admin' | 'editor';
  expires_at: string;
  invited_at: string;
};
export type MembersResponse = {
  members: MemberItem[];
  invitations: PendingInvitation[];
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
  notify_ai_credits: boolean;
  notify_content_gaps: boolean;
  notify_invite_accepted: boolean;
  github_handle?: string | null;
};
export function getAccount(): Promise<AccountInfo | null> {
  return apiGet<AccountInfo>('/api/v1/account');
}

export type PlatformStaffMember = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  role: 'admin' | 'support';
  two_factor_enabled: boolean;
  last_active_at: string;
  created_at: string;
};

export type PlatformStaffResponse = {
  staff: PlatformStaffMember[];
};

export type PlatformAuditLogEntry = {
  id: string;
  created_at: string;
  actor_kind: string;
  actor_id: string;
  actor_name: string;
  actor_email?: string | null;
  action: string;
  tenant_name: string;
  organization_id?: string | null;
  detail: Record<string, unknown>;
};

export type PlatformAuditLogResponse = {
  audit_logs: PlatformAuditLogEntry[];
};

export async function getPlatformStaff(): Promise<{
  staff: PlatformStaffMember[] | null;
  forbidden: boolean;
}> {
  const { status, body } = await apiGetStatus<PlatformStaffResponse>('/api/v1/platform/staff');
  return { staff: body?.staff ?? null, forbidden: status === 403 };
}

export async function getPlatformAuditLogs(): Promise<{
  auditLogs: PlatformAuditLogEntry[] | null;
  forbidden: boolean;
}> {
  const { status, body } = await apiGetStatus<PlatformAuditLogResponse>('/api/v1/platform/audit-log');
  return { auditLogs: body?.audit_logs ?? null, forbidden: status === 403 };
}

export async function getPlatformMe(): Promise<{
  staff: { id: string; name: string; email: string; role: 'admin' | 'support' } | null;
  forbidden: boolean;
}> {
  const { status, body } = await apiGetStatus<{ staff: { id: string; name: string; email: string; role: 'admin' | 'support' } }>('/api/v1/platform/me');
  return { staff: body?.staff ?? null, forbidden: status === 403 };
}

export type PlatformReportItem = {
  id: string;
  type: string;
  status: 'new' | 'in_review' | 'actioned' | 'dismissed';
  text: string;
  guide_address: string;
  guide_slug: string | null;
  tenant_name: string;
  tenant_slug: string | null;
  organization_id: string | null;
  flow_id: string | null;
  notes: string | null;
  reporter_email: string | null;
  reporter_email_masked: string | null;
  reporter_email_revealed: boolean;
  reporter_email_revealed_at: string | null;
  guide_visibility: string | null;
  guide_title: string | null;
  tenant_status: string;
  created_at: string;
  updated_at: string;
};

export type PlatformReportsResponse = {
  reports: PlatformReportItem[];
  counts: {
    new: number;
    in_review: number;
    actioned: number;
    dismissed: number;
    total: number;
  };
};

export async function getPlatformReports(status?: string): Promise<{
  reports: PlatformReportItem[] | null;
  counts: PlatformReportsResponse['counts'] | null;
  forbidden: boolean;
}> {
  const query = status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : '';
  const { status: httpStatus, body } = await apiGetStatus<PlatformReportsResponse>(
    `/api/v1/platform/reports${query}`,
  );
  return {
    reports: body?.reports ?? null,
    counts: body?.counts ?? null,
    forbidden: httpStatus === 403,
  };
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

export type PlatformTenantItem = {
  id: string;
  name: string;
  slug: string;
  address: string;
  plan: string;
  guides_count: number;
  storage_bytes: number;
  status: 'active' | 'suspended';
  created_at: string;
  suspended_at?: string | null;
};

export type PlatformTenantsResponse = {
  tenants: PlatformTenantItem[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
};

export async function getPlatformTenants(params?: {
  q?: string;
  plan?: string;
  page?: number;
  limit?: number;
}): Promise<{
  data: PlatformTenantsResponse | null;
  forbidden: boolean;
}> {
  const searchParams = new URLSearchParams();
  if (params?.q) searchParams.set('q', params.q);
  if (params?.plan && params.plan !== 'all') searchParams.set('plan', params.plan);
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const query = searchParams.toString();
  const { status, body } = await apiGetStatus<PlatformTenantsResponse>(
    `/api/v1/platform/tenants${query ? `?${query}` : ''}`,
  );
  return { data: body ?? null, forbidden: status === 403 };
}

export type PlatformTenantDetail = {
  id: string;
  name: string;
  slug: string;
  address: string;
  created_at: string;
  suspended_at: string | null;
  status: 'active' | 'suspended';
  plan: string;
  guides_count: number;
  storage_bytes: number;
  domain: {
    primary: string;
    custom_domain: string | null;
    domain_status: string | null;
    cert_expires_at: string | null;
    last_checked_at: string | null;
  };
  ai_credits: {
    balance: number;
    used_this_month: number;
    monthly_limit: number;
    model: string;
    byo_set: boolean;
  };
  audit_logs: PlatformAuditLogEntry[];
};

export async function getPlatformTenant(slug: string): Promise<{
  tenant: PlatformTenantDetail | null;
  forbidden: boolean;
  notFound: boolean;
}> {
  const { status, body } = await apiGetStatus<{ tenant: PlatformTenantDetail }>(
    `/api/v1/platform/tenants/${encodeURIComponent(slug)}`,
  );
  return {
    tenant: body?.tenant ?? null,
    forbidden: status === 403,
    notFound: status === 404,
  };
}

export type PlatformDomainItem = {
  domain: string;
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  status: 'verified' | 'waiting_dns' | 'cert_failing' | 'blocked';
  cert_expires_at: string | null;
  last_checked_at: string | null;
};

export type PlatformDomainsResponse = {
  domains: PlatformDomainItem[];
  total: number;
};

export async function getPlatformDomains(filter?: string): Promise<{
  data: PlatformDomainsResponse | null;
  forbidden: boolean;
}> {
  const query = filter && filter !== 'all' ? `?filter=${encodeURIComponent(filter)}` : '';
  const { status, body } = await apiGetStatus<PlatformDomainsResponse>(
    `/api/v1/platform/domains${query}`,
  );
  return { data: body ?? null, forbidden: status === 403 };
}

export type AssistantSettings = {
  organization_id: string;
  enabled: boolean;
  name: string;
  button_label: string;
  welcome: string;
  suggested: string[];
  tone: 'friendly' | 'concise' | 'formal';
  language: string;
  source_mode: 'all' | 'categories';
  source_category_ids: string[];
  excluded_flow_ids: string[];
  no_match_mode: 'contact' | 'email' | 'hide';
  contact_target: string;
  off_topic_refusal: boolean;
  show_sources: boolean;
  hourly_per_visitor: number;
  daily_cap: number;
  retention_days: number;
  mask_pii: boolean;
  position: 'bottom-right' | 'bottom-left';
  model_id: string | null;
  byo_enabled: boolean;
  byo_provider: string | null;
  byo_base_url: string | null;
  byo_model: string | null;
  byo_secret_set: boolean;
  byo_secret_masked: string | null;
  byo_fallback_credits: boolean;
  embed_origins: string[];
  created_at: string;
  updated_at: string;
};

export type AssistantCredits = {
  used: number;
  total: number;
  percent: number;
  reset_date: string;
};

export type AssistantModelOption = {
  id: string;
  model_id: string;
  name: string;
  provider: string;
  label: string;
  credits_per_reply: number;
  is_default: boolean;
};

export type AssistantModelReplyStat = {
  model_id: string;
  model_name: string;
  replies_count: number;
  credits_used: number;
};

export type AssistantIndexStatus = {
  indexed_count: number;
  total_count: number;
  last_indexed_at: string | null;
};

export type AssistantResponse = {
  assistant: AssistantSettings;
  credits: AssistantCredits;
  models: AssistantModelOption[];
  replies_by_model: AssistantModelReplyStat[];
  index_status: AssistantIndexStatus;
};

export type AssistantStats = {
  days: number;
  questions: number;
  answered_percent: number;
  helpful_percent: number;
  content_gaps: number;
  credits_used: number;
};

export type ContentGapItem = {
  id: string;
  query: string;
  count: number;
  status: string;
  flow_id: string | null;
  flow: { id: string; title: string; slug: string } | null;
  last_seen_at: string;
  created_at: string;
};

export type AssistantMessageItem = {
  id: string;
  role: string;
  content: string;
  answered: boolean;
  rating: string | null;
  feedback: string | null;
  cited_flow_ids: string[];
  model_id: string | null;
  tokens_used: number;
  created_at: string;
};

export type AssistantConversationItem = {
  id: string;
  visitor_id: string;
  created_at: string;
  updated_at: string;
  question: string;
  answered: boolean;
  rating: string | null;
  messages: AssistantMessageItem[];
};

export async function getAssistant(): Promise<AssistantResponse | null> {
  return apiGet<AssistantResponse>('/api/v1/assistant');
}

export type BillingSubscription = {
  plan: string;
  status: 'active' | 'past_due' | 'canceled' | 'canceled_at_period_end' | 'free';
  billing_cycle: string;
  next_invoice_date: string | null;
  period_end: string | null;
  cancel_at_period_end: boolean;
};

export type BillingPaymentMethod = {
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
};

export type BillingInvoiceDetails = {
  email: string;
  company: string;
  tax_id: string;
};

export type BillingInvoice = {
  id: string;
  date: string;
  number: string;
  amount: string;
  status: 'paid' | 'pending' | 'draft' | 'failed';
  pdf_url: string | null;
};

export type BillingAiCreditPack = {
  credits: number;
  price: string;
};

export type BillingAiCredits = {
  balance: number;
  packs: BillingAiCreditPack[];
};

export type BillingResponse = {
  subscription: BillingSubscription;
  payment_method: BillingPaymentMethod | null;
  invoice_details: BillingInvoiceDetails;
  invoices: BillingInvoice[];
  invoices_unavailable?: boolean;
  portal_url: string | null;
  ai_credits: BillingAiCredits;
};

export async function getBilling(): Promise<BillingResponse | null> {
  return apiGet<BillingResponse>('/api/v1/billing');
}

export async function getAssistantStats(days: number = 30): Promise<AssistantStats | null> {
  return apiGet<AssistantStats>(`/api/v1/assistant/stats?days=${days}`);
}

export async function getAssistantGaps(status?: string): Promise<{ gaps: ContentGapItem[] } | null> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiGet<{ gaps: ContentGapItem[] }>(`/api/v1/assistant/gaps${query}`);
}

export async function getAssistantConversations(
  days: number = 30,
): Promise<{ conversations: AssistantConversationItem[] } | null> {
  return apiGet<{ conversations: AssistantConversationItem[] }>(
    `/api/v1/assistant/conversations?days=${days}`,
  );
}


