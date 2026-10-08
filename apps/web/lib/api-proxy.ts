const DEFAULT_API_ORIGIN = 'http://localhost:4000';

const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];

/** API origin, read from the environment on every call so one image serves any deployment. */
export function apiOrigin(env: Record<string, string | undefined> = process.env): string {
  return (env.API_ORIGIN || DEFAULT_API_ORIGIN).replace(/\/+$/, '');
}

function stripHopByHop(headers: Headers): void {
  for (const name of (headers.get('connection') ?? '').split(',')) {
    if (name.trim()) headers.delete(name.trim());
  }
  for (const name of HOP_BY_HOP) headers.delete(name);
}

/**
 * Forwards a request to the API at `API_ORIGIN` (read per request, not at build time).
 * Bodies stream both ways, redirects and Set-Cookie pass through untouched.
 */
export async function proxyToApi(
  request: Request,
  path: string,
  env: Record<string, string | undefined> = process.env,
): Promise<Response> {
  const incoming = new URL(request.url);
  const target = `${apiOrigin(env)}${path}${incoming.search}`;

  const headers = new Headers(request.headers);
  stripHopByHop(headers);
  const host = headers.get('host');
  headers.delete('host');
  if (host && !headers.has('x-forwarded-host')) headers.set('x-forwarded-host', host);
  if (!headers.has('x-forwarded-proto')) {
    headers.set('x-forwarded-proto', incoming.protocol.replace(':', ''));
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    // Required by undici when streaming a request body.
    ...(hasBody ? { duplex: 'half' } : {}),
    redirect: 'manual',
    cache: 'no-store',
  } as RequestInit);

  const responseHeaders = new Headers(upstream.headers);
  stripHopByHop(responseHeaders);
  // fetch() already decoded the body, so these no longer describe it.
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
