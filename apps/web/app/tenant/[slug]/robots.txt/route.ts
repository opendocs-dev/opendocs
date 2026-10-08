import { notFound } from 'next/navigation';

import { getSiteInfo } from '@/lib/tenant-api';
import { buildRobots, tenantOrigin } from '@/lib/tenant-url';

type RouteParams = { slug: string };

export async function GET(request: Request, { params }: { params: Promise<RouteParams> }) {
  const { slug } = await params;
  const info = await getSiteInfo(slug);
  if (!info) notFound();

  return new Response(buildRobots(tenantOrigin(request.headers), info.indexing), {
    headers: { 'content-type': 'text/plain' },
  });
}
