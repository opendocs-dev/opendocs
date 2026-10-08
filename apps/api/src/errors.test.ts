import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { ApiError, errorPlugin } from './errors';
import { createApp } from './index';

const request = (path: string, version?: string) =>
  new Request(`http://localhost${path}`, {
    headers: version ? { 'x-opendocs-cli-version': version } : {},
  });

test('unauthorized maps to 401 error shape', async () => {
  const app = new Elysia()
    .use(errorPlugin)
    .get('/api/v1/me', () => {
      throw new ApiError(401, 'unauthorized', 'Authentication required');
    });
  const response = await app.handle(request('/api/v1/me'));
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({
    error: { code: 'unauthorized', message: 'Authentication required' },
  });
});

test('old CLI version maps to 426 error shape', async () => {
  const response = await createApp(async () => {}).handle(request('/api/v1/me', '0.0.1'));
  expect(response.status).toBe(426);
  expect(await response.json()).toEqual({
    error: { code: 'upgrade_required', message: 'CLI upgrade required' },
  });
});

test('missing version header does not trigger 426', async () => {
  const response = await createApp(async () => {}).handle(request('/api/v1/me'));
  // The route now exists, so an unauthenticated call stops at 401 rather than 426.
  expect(response.status).toBe(401);
});

test('unknown route returns json error shape', async () => {
  const response = await createApp(async () => {}).handle(request('/api/v1/bogus'));
  expect(response.status).toBe(404);
  expect(response.headers.get('content-type')).toContain('application/json');
  expect(await response.json()).toEqual({ error: { code: 'not_found', message: 'Route not found' } });
});

test('uncaught exception returns 500 error shape', async () => {
  const app = new Elysia()
    .use(errorPlugin)
    .get('/api/v1/me', () => {
      throw new Error('sensitive details');
    });
  const response = await app.handle(request('/api/v1/me'));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: { code: 'internal_error', message: 'Internal server error' },
  });
});
