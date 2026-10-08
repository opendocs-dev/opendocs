const DEFAULT_API_ORIGIN = 'http://localhost:4000';

/**
 * Proxy rules that forward the browser's /api/* calls to the Elysia API.
 * Keeping this in one place lets the web app talk to the API through a
 * same-origin path, so no CORS handling is needed in the browser.
 */
export function apiRewrites(apiOrigin = process.env.API_ORIGIN) {
  const origin = (apiOrigin ?? DEFAULT_API_ORIGIN).replace(/\/+$/, '');

  return [
    {
      source: '/d/:id.md',
      destination: `${origin}/api/v1/docs/:id/markdown`,
    },
    {
      source: '/api/:path*',
      destination: `${origin}/api/:path*`,
    },
  ];
}
