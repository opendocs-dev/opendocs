import { proxyToApi } from '../../../lib/api-proxy';

// Runtime proxy to the API: API_ORIGIN is read per request, so it is not baked in at `next build`.
export const dynamic = 'force-dynamic';

async function handler(request: Request): Promise<Response> {
  return proxyToApi(request, new URL(request.url).pathname);
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE, handler as HEAD, handler as OPTIONS };
