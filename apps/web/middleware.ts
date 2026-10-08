import { NextResponse, type NextRequest } from 'next/server';
import { isUnderBase, parseTenantHost, tenantRewritePath } from './lib/tenant-host';

const DEFAULT_API_ORIGIN = 'http://localhost:4000';
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 1000;

type ResolveResult = { status: 'active' } | { status: 'redirect'; slug: string } | { status: 'missing' };

/** 60s in-memory cache per slug, so every request on a tenant host doesn't hit the API. */
const cache = new Map<string, { result: ResolveResult; expiresAt: number }>();

/**
 * One shared 404, so an unknown tenant, a suspended one, and a direct `/tenant/...`
 * request on a non-tenant host all answer with the exact same body.
 */
const notFoundResponse = (): NextResponse =>
  new NextResponse('Not Found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });

/** These paths make no sense on a tenant host (dashboard, API, auth), so they 404 there. */
const isBlockedOnTenantHost = (pathname: string): boolean =>
  pathname.startsWith('/d') ||
  pathname.startsWith('/api') ||
  pathname.startsWith('/dashboard') ||
  pathname.startsWith('/sign-in') ||
  pathname.startsWith('/_next/data');

const passesThroughUnchanged = (pathname: string): boolean =>
  pathname.startsWith('/_next/static') || pathname === '/favicon.ico';

const resolveSlug = async (slug: string): Promise<ResolveResult> => {
  const now = Date.now();
  const cached = cache.get(slug);
  if (cached && cached.expiresAt > now) return cached.result;

  const origin = (process.env.API_ORIGIN ?? DEFAULT_API_ORIGIN).replace(/\/+$/, '');

  try {
    const response = await fetch(`${origin}/api/v1/site/resolve?slug=${encodeURIComponent(slug)}`);
    if (!response.ok) return { status: 'missing' };
    const result = (await response.json()) as ResolveResult;
    // ponytail: wildcard DNS lets anyone invent slugs, so the cache is capped; a transient API error is never cached.
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(slug, { result, expiresAt: now + CACHE_TTL_MS });
    return result;
  } catch {
    return { status: 'missing' };
  }
};

export async function middleware(request: NextRequest) {
  const base = process.env.TENANT_BASE_DOMAIN;
  const host = request.headers.get('host') ?? '';
  const slug = parseTenantHost(host, base);
  const pathname = request.nextUrl.pathname;

  if (!slug) {
    // The base domain itself, `a.b.base` and similar are never valid tenants and must not
    // fall through to the dashboard routes.
    if (isUnderBase(host, base)) return notFoundResponse();
    if (pathname.startsWith('/tenant')) return notFoundResponse();
    return NextResponse.next();
  }

  if (passesThroughUnchanged(pathname)) return NextResponse.next();
  if (isBlockedOnTenantHost(pathname)) return notFoundResponse();

  const result = await resolveSlug(slug);

  if (result.status === 'missing') return notFoundResponse();

  if (result.status === 'redirect') {
    // Build the URL from parts: a path like `//evil.com` must not become protocol-relative.
    const port = request.nextUrl.port ? `:${request.nextUrl.port}` : '';
    const safePath = `/${pathname.replace(/^\/+/, '')}`;
    return NextResponse.redirect(
      `${request.nextUrl.protocol}//${result.slug}.${base}${port}${safePath}${request.nextUrl.search}`,
      301,
    );
  }

  const rewriteUrl = request.nextUrl.clone();
  rewriteUrl.pathname = tenantRewritePath(slug, pathname);
  return NextResponse.rewrite(rewriteUrl);
}
