import { NextResponse } from 'next/server';

import { searchGuides } from '@/lib/tenant-api';

type RouteParams = { slug: string };

export async function GET(request: Request, { params }: { params: Promise<RouteParams> }) {
  const { slug } = await params;
  const q = new URL(request.url).searchParams.get('q') ?? '';

  if (q.trim() === '') {
    return NextResponse.json({ results: [] }, { headers: { 'cache-control': 'public, max-age=30' } });
  }

  const response = await searchGuides(slug, q);
  const results = response?.results.slice(0, 5) ?? [];

  return NextResponse.json({ results }, { headers: { 'cache-control': 'public, max-age=30' } });
}
