import { V1_ROUTES } from '@opendocs/core';
import { expect, test } from 'bun:test';
import { createApp } from './index';

// V1_ROUTES registers the /api surface the CLI talks to. Mounts outside it by design:
// Better-Auth's root catch-all (`ALL /*`, which only serves /api/auth/*), the public image
// delivery route /api/i/:id and the /api/health alias (the contract lists /api/healthz).
// /api/v1/site/* serves the dashboard and the web middleware, not the CLI, so it stays out
// of the CLI contract (as does the web-only /api/v1/docs/{id}/canonical). Everything else
// under /api must be in it.
const isContractRoute = (route: { method: string; path: string }) =>
  !(route.method === 'ALL' && route.path === '/*') && route.path.startsWith('/api/') &&
  !route.path.startsWith('/api/v1/site') &&
  !route.path.startsWith('/api/i/') &&
  route.path !== '/api/health' &&
  !route.path.endsWith('/canonical') &&
  // Category management is session-only (dashboard), so only GET /api/v1/categories is CLI contract (C17-AC12).
  !(route.path.startsWith('/api/v1/categories') && !(route.method === 'GET' && route.path === '/api/v1/categories')) &&
  !(route.path.startsWith('/api/v1/flows/') && route.path.endsWith('/category')) &&
  // Admin routes are session-only (dashboard): flow PATCH, bulk update and overview (C18).
  !(route.method === 'PATCH' && route.path === '/api/v1/flows/:publicId') &&
  !(route.method === 'POST' && route.path === '/api/v1/flows/bulk') &&
  route.path !== '/api/v1/overview' &&
  // Recording status (UI-A17 live progress) is dashboard-only.
  route.path !== '/api/v1/recording-status' &&
  // Steps editor routes and runs history are session-only (dashboard) (C19, UI-A16).
  !(route.path.startsWith('/api/v1/flows/') && (route.path.includes('/steps') || route.path.endsWith('/runs'))) &&
  // Members and account settings (C14-AC24, AC25) are dashboard-only, like /site.
  !route.path.startsWith('/api/v1/members') &&
  !route.path.startsWith('/api/v1/account') &&
  // AI assistant settings are dashboard-only.
  !route.path.startsWith('/api/v1/assistant') &&
  // Activity log (AC-30) is dashboard-only.
  !route.path.startsWith('/api/v1/activity-log') &&
  // Analytics routes (C14-AC29) are dashboard-only.
  !route.path.startsWith('/api/v1/analytics');

// Elysia's router only matches `:id`, while the contract spells parameters `{id}`.
const contractPath = (path: string) => path.replace(/:([^/]+)/g, '{$1}');

test('every mounted route is listed in V1_ROUTES', () => {
  const app = createApp(async () => {});
  const known: readonly string[] = V1_ROUTES;
  const contractRoutes = app.routes.filter(isContractRoute);

  for (const route of contractRoutes) {
    expect(known).toContain(`${route.method} ${contractPath(route.path)}`);
  }
  expect(contractRoutes.length).toBeGreaterThan(0);
});

test('every V1_ROUTES entry is still mounted', () => {
  const app = createApp(async () => {});
  const mounted = app.routes.map((route) => `${route.method} ${contractPath(route.path)}`);

  for (const entry of V1_ROUTES) {
    expect(mounted).toContain(entry);
  }
});
