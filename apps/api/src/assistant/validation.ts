import { decryptAiSecret, maskSecret } from '../platform/ai-secret';

export const validateSsrfUrl = (rawUrl: string): { ok: boolean; error?: string } => {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { ok: false, error: 'Base URL must be provided' };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'Base URL must be a valid URL' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'Base URL must use HTTPS' };
  }

  const hostname = parsed.hostname.toLowerCase().trim();

  // Refuse localhost and local domain names
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return { ok: false, error: 'Private addresses are refused' };
  }

  // IPv4 checks
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (ipv4Match) {
    const o1 = Number(ipv4Match[1]);
    const o2 = Number(ipv4Match[2]);
    const o3 = Number(ipv4Match[3]);
    const o4 = Number(ipv4Match[4]);
    if (o1 > 255 || o2 > 255 || o3 > 255 || o4 > 255) {
      return { ok: false, error: 'Invalid IP address' };
    }
    // Loopback 127.0.0.0/8
    if (o1 === 127) return { ok: false, error: 'Private addresses are refused' };
    // 0.0.0.0/8
    if (o1 === 0) return { ok: false, error: 'Private addresses are refused' };
    // Private 10.0.0.0/8
    if (o1 === 10) return { ok: false, error: 'Private addresses are refused' };
    // Carrier-grade NAT 100.64.0.0/10
    if (o1 === 100 && o2 >= 64 && o2 <= 127) return { ok: false, error: 'Private addresses are refused' };
    // Private 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return { ok: false, error: 'Private addresses are refused' };
    // Link-local / Cloud metadata 169.254.0.0/16
    if (o1 === 169 && o2 === 254) return { ok: false, error: 'Private addresses are refused' };
    // Private 192.168.0.0/16
    if (o1 === 192 && o2 === 168) return { ok: false, error: 'Private addresses are refused' };
    // Documentation / Test net
    if (o1 === 192 && o2 === 0 && (o3 === 0 || o3 === 2)) return { ok: false, error: 'Private addresses are refused' };
    if (o1 === 198 && o2 === 51 && o3 === 100) return { ok: false, error: 'Private addresses are refused' };
    if (o1 === 203 && o2 === 0 && o3 === 113) return { ok: false, error: 'Private addresses are refused' };
    // Broadcast / Multicast / Reserved
    if (o1 >= 224) return { ok: false, error: 'Private addresses are refused' };
  }

  // IPv6 checks (wrapped in brackets in URL hostname)
  const cleanIpv6 = hostname.replace(/^\[|\]$/g, '');
  if (
    cleanIpv6 === '::1' ||
    cleanIpv6 === '::' ||
    cleanIpv6.startsWith('fe80:') ||
    cleanIpv6.startsWith('fc') ||
    cleanIpv6.startsWith('fd')
  ) {
    return { ok: false, error: 'Private addresses are refused' };
  }

  return { ok: true };
};

export const maskSecretSafe = (stored: string): string => {
  try {
    const decrypted = decryptAiSecret(stored);
    return maskSecret(decrypted);
  } catch {
    return '••••••••';
  }
};

export const parseJsonArray = (val: unknown): string[] => {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return [];
    }
  }
  return [];
};

export const sanitizeAssistant = (row: {
  organizationId: string;
  enabled: boolean;
  name: string;
  buttonLabel: string;
  welcome: string;
  suggested: unknown;
  tone: string;
  language: string;
  sourceMode: string;
  sourceCategoryIds: unknown;
  excludedFlowIds: unknown;
  noMatchMode: string;
  contactTarget: string;
  offTopicRefusal: boolean;
  showSources: boolean;
  hourlyPerVisitor: number;
  dailyCap: number;
  retentionDays: number;
  maskPii: boolean;
  position: string;
  modelId: string | null;
  byoEnabled: boolean;
  byoProvider: string | null;
  byoBaseUrl: string | null;
  byoModel: string | null;
  byoSecret: string | null;
  byoFallbackCredits: boolean;
  embedOrigins: unknown;
  createdAt?: Date;
  updatedAt?: Date;
}) => ({
  organization_id: row.organizationId,
  enabled: row.enabled,
  name: row.name,
  button_label: row.buttonLabel,
  welcome: row.welcome,
  suggested: parseJsonArray(row.suggested),
  tone: row.tone,
  language: row.language,
  source_mode: row.sourceMode,
  source_category_ids: parseJsonArray(row.sourceCategoryIds),
  excluded_flow_ids: parseJsonArray(row.excludedFlowIds),
  no_match_mode: row.noMatchMode,
  contact_target: row.contactTarget,
  off_topic_refusal: row.offTopicRefusal,
  show_sources: row.showSources,
  hourly_per_visitor: row.hourlyPerVisitor,
  daily_cap: row.dailyCap,
  retention_days: row.retentionDays,
  mask_pii: row.maskPii,
  position: row.position,
  model_id: row.modelId,
  byo_enabled: row.byoEnabled,
  byo_provider: row.byoProvider,
  byo_base_url: row.byoBaseUrl,
  byo_model: row.byoModel,
  byo_secret_set: Boolean(row.byoSecret),
  byo_secret_masked: row.byoSecret ? maskSecretSafe(row.byoSecret) : null,
  byo_fallback_credits: row.byoFallbackCredits,
  embed_origins: parseJsonArray(row.embedOrigins),
  created_at: row.createdAt ? row.createdAt.toISOString() : new Date().toISOString(),
  updated_at: row.updatedAt ? row.updatedAt.toISOString() : new Date().toISOString(),
});

export const validateSuggestedQuestions = (suggested: unknown): string[] => {
  if (!Array.isArray(suggested)) {
    throw new Error('Suggested questions must be an array');
  }
  if (suggested.length > 4) {
    throw new Error('Suggested questions cannot exceed 4');
  }
  return suggested.map((q) => String(q).trim()).filter(Boolean);
};

export const isValidContactTarget = (raw: string): boolean => {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;

  const emailCandidate = trimmed.startsWith('mailto:') ? trimmed.slice(7) : trimmed;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (emailRegex.test(emailCandidate)) {
    return true;
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};
