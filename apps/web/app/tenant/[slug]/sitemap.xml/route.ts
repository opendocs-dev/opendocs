import { notFound } from 'next/navigation';

import { getCategories, getGuides, getSiteInfo } from '@/lib/tenant-api';
import { buildSitemap, tenantOrigin } from '@/lib/tenant-url';

type RouteParams = { slug: string };

const PAGE_SIZE = 50;

async function allGuides(slug: string) {
  const guides = [];
  let offset = 0;

  for (;;) {
    const page = await getGuides(slug, PAGE_SIZE, offset);
    // An empty page ends the loop even when `total` says more: guides can vanish between queries.
    if (!page || page.guides.length === 0) break;
    guides.push(...page.guides);
    offset += page.guides.length;
    if (offset >= page.total) break;
  }

  return guides;
}

export async function GET(request: Request, { params }: { params: Promise<RouteParams> }) {
  const { slug } = await params;
  const info = await getSiteInfo(slug);
  if (!info) notFound();

  const origin = tenantOrigin(request.headers);
  // With indexing off the sitemap lists nothing (the pages are noindex and robots.txt blocks them).
  const guides = info.indexing ? await allGuides(slug) : [];
  const categoriesResponse = info.indexing ? await getCategories(slug) : null;
  const categories = categoriesResponse?.categories ?? [];

  return new Response(buildSitemap(origin, guides, categories, info.indexing), {
    headers: { 'content-type': 'application/xml' },
  });
}
