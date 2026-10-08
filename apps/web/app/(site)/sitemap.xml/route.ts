import { notFound } from 'next/navigation';

import { getCategories, getGuides, getSiteInfo } from '@/lib/site-api';
import { buildSitemap, siteOrigin } from '@/lib/site-url';

const PAGE_SIZE = 50;

async function allGuides() {
  const guides = [];
  let offset = 0;

  for (;;) {
    const page = await getGuides(PAGE_SIZE, offset);
    // An empty page ends the loop even when `total` says more: guides can vanish between queries.
    if (!page || page.guides.length === 0) break;
    guides.push(...page.guides);
    offset += page.guides.length;
    if (offset >= page.total) break;
  }

  return guides;
}

export async function GET(request: Request) {
  const info = await getSiteInfo();
  if (!info) notFound();

  const origin = siteOrigin(request.headers);
  // With indexing off the sitemap lists nothing (the pages are noindex and robots.txt blocks them).
  const guides = info.indexing ? await allGuides() : [];
  const categoriesResponse = info.indexing ? await getCategories() : null;
  const categories = categoriesResponse?.categories ?? [];

  return new Response(buildSitemap(origin, guides, categories, info.indexing), {
    headers: { 'content-type': 'application/xml' },
  });
}
