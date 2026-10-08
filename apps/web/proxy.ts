import { NextResponse, type NextRequest } from 'next/server';

// `/d/{id}.md` serves the raw markdown of a doc. Rewritten to the API path, which the /api route handler proxies.
export function proxy(request: NextRequest) {
  const id = request.nextUrl.pathname.replace(/^\/d\//, '').replace(/\.md$/, '');
  const url = request.nextUrl.clone();
  url.pathname = `/api/v1/docs/${id}/markdown`;
  return NextResponse.rewrite(url);
}

export const config = { matcher: '/d/:id.md' };
