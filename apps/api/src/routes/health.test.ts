import { describe, expect, test } from 'bun:test';
import { createApp } from '../index';

const request = new Request('http://localhost/api/healthz');

describe('health route', () => {
  test('returns 200 when DB reachable', async () => {
    const response = await createApp(async () => {}).handle(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', db: 'up' });
  });

  test('answers on /api/health as well', async () => {
    const response = await createApp(async () => {}).handle(new Request('http://localhost/api/health'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', db: 'up' });
  });

  test('returns 503 when DB unreachable', async () => {
    const response = await createApp(async () => {
      throw new Error('offline');
    }).handle(request);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'error', db: 'down' });
  });

  test('returns 503 within timeout instead of hanging', async () => {
    const start = performance.now();
    const response = await createApp(() => new Promise(() => {})).handle(request);
    expect(response.status).toBe(503);
    expect(performance.now() - start).toBeLessThan(2500);
    expect(await response.json()).toEqual({ status: 'error', db: 'down' });
  });
});
