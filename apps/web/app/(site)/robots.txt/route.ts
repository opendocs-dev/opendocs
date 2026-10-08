import { notFound } from 'next/navigation';

import { getSiteInfo } from '@/lib/site-api';
import { buildRobots, siteOrigin } from '@/lib/site-url';

export async function GET(request: Request) {
  const info = await getSiteInfo();
  if (!info) notFound();

  return new Response(buildRobots(siteOrigin(request.headers), info.indexing), {
    headers: { 'content-type': 'text/plain' },
  });
}
