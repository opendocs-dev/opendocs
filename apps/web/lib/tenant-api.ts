import type { DocStep } from '@opendocs/core';
import { apiOrigin } from './server-api';

export type CustomMetaTag = { name: string; content: string };

export type PublicAssistantConfig = {
  enabled: boolean;
  name: string;
  button_label: string;
  welcome: string;
  suggested: string[];
  position: 'bottom-right' | 'bottom-left';
  show_sources: boolean;
  no_match_mode: 'contact' | 'email' | 'hide';
  contact_target: string;
};

export type ChatSource = {
  id: string;
  slug: string;
  title: string;
  step_range: string;
  start_step: number;
  end_step: number;
};

export type ChatResponse = {
  conversation_id: string;
  message_id: string;
  status: 'answered' | 'no_match' | 'out_of_credits';
  content: string;
  sources: ChatSource[];
  contact?: {
    mode: 'contact' | 'email' | 'hide';
    target: string;
  };
};

export type SiteInfo = {
  title: string;
  tagline: string;
  description: string;
  preset: string;
  accent?: string | null;
  mark?: string | null;
  font?: string | null;
  radius?: number | null;
  indexing: boolean;
  is_free_plan: boolean;
  guides: number;
  favicon_url: string | null;
  og_image_url: string | null;
  custom_meta: CustomMetaTag[];
  assistant?: PublicAssistantConfig | null;
};

export type CategoryRef = { slug: string; name: string } | null;

export type GuideSummary = {
  slug: string;
  title: string;
  summary: string;
  updated_at: string;
  steps: number;
  category: CategoryRef;
  noindex: boolean;
};

export type GuidesResponse = {
  guides: GuideSummary[];
  total: number;
};

export type SearchResult = {
  slug: string;
  title: string;
  summary: string;
  snippet: string;
  steps?: number;
  category: CategoryRef;
};

export type SearchResponse = {
  results: SearchResult[];
  counts: { slug: string; name: string; count: number }[];
};

export type GuideNeighbour = { slug: string; title: string } | null;

export type Guide = {
  public_id: string;
  title: string;
  plan?: string;
  is_free_plan?: boolean;
  steps: DocStep[];
  slug: string;
  summary: string;
  visibility: string;
  updated_at: string;
  seo_title: string | null;
  seo_description: string | null;
  noindex: boolean;
  prev: GuideNeighbour;
  next: GuideNeighbour;
  category: CategoryRef;
};

export type CategoryItem = {
  slug: string;
  name: string;
  description: string;
  guides: number;
  sample_guides?: { slug: string; title: string }[];
};

export type CategoriesResponse = {
  categories: CategoryItem[];
};

/** Public site API calls never throw on a non-OK response; the caller treats null as "not found". */
async function siteGet<T>(path: string): Promise<T | null> {
  const response = await fetch(`${apiOrigin()}${path}`, { cache: 'no-store' });
  if (!response.ok) return null;
  return (await response.json()) as T;
}

export function getSiteInfo(slug: string): Promise<SiteInfo | null> {
  return siteGet<SiteInfo>(`/api/v1/site/${encodeURIComponent(slug)}/info`);
}

export function getGuides(slug: string, limit: number, offset: number, category?: string): Promise<GuidesResponse | null> {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  if (category !== undefined) {
    params.set('category', category);
  }
  const query = `?${params.toString()}`;
  return siteGet<GuidesResponse>(`/api/v1/site/${encodeURIComponent(slug)}/guides${query}`);
}

export function searchGuides(slug: string, q: string, category?: string): Promise<SearchResponse | null> {
  const params = new URLSearchParams();
  params.set('q', q);
  if (category !== undefined) {
    params.set('category', category);
  }
  const query = `?${params.toString()}`;
  return siteGet<SearchResponse>(`/api/v1/site/${encodeURIComponent(slug)}/search${query}`);
}

export function getGuide(slug: string, guideSlug: string): Promise<Guide | null> {
  return siteGet<Guide>(`/api/v1/site/${encodeURIComponent(slug)}/guides/${encodeURIComponent(guideSlug)}`);
}

export function getCategories(slug: string): Promise<CategoriesResponse | null> {
  return siteGet<CategoriesResponse>(`/api/v1/site/${encodeURIComponent(slug)}/categories`);
}

export async function getAssistantConfig(slug: string): Promise<PublicAssistantConfig | null> {
  const res = await siteGet<{ assistant: PublicAssistantConfig }>(`/api/v1/site/${encodeURIComponent(slug)}/assistant`);
  return res?.assistant ?? null;
}

