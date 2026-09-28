import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { FetchLike } from './api';
import { createMcpServer } from './mcp';

// Token-shaped value assembled at runtime: no key literal in source.
const testKey = ['od', 'test', 'aaaabbbbcccc'].join('_');

const SMALL_WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);

let tmp: string;
let imagePath: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'opendocs-mcp-'));
  imagePath = path.join(tmp, 'shot.webp');
  await Bun.write(imagePath, SMALL_WEBP);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** Connect a fresh client/server pair over an in-memory transport. */
async function connect(deps: { fetch?: FetchLike; readKey?: () => Promise<string | null> } = {}) {
  const server = createMcpServer(deps);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

/** Stub fetch that returns a fixed JSON body and status for every call. */
function stubFetch(body: unknown, status: number): FetchLike {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

/** Stub fetch that inspects the URL/method to route asset/run/step/compile calls. */
function routedFetch(handlers: {
  assets?: (init: unknown) => Response;
  runs?: (init: unknown) => Response;
  steps?: (init: unknown) => Response;
  compile?: (init: unknown) => Response;
}): FetchLike {
  return async (url, init) => {
    if (url.includes('/assets')) return handlers.assets?.(init) ?? new Response('{}', { status: 500 });
    if (url.includes('/compile')) return handlers.compile?.(init) ?? new Response('{}', { status: 500 });
    if (url.includes('/steps')) return handlers.steps?.(init) ?? new Response('{}', { status: 500 });
    if (url.endsWith('/runs')) return handlers.runs?.(init) ?? new Response('{}', { status: 500 });
    return new Response('{}', { status: 404 });
  };
}

function estimatedTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

test('lists exactly 3 tools', async () => {
  const client = await connect({ readKey: async () => testKey, fetch: stubFetch({}, 500) });
  const { tools } = await client.listTools();

  expect(tools.length).toBe(3);
  expect(tools.map((t) => t.name).sort()).toEqual([
    'opendocs_compile',
    'opendocs_snap',
    'opendocs_step',
  ]);
});

test('opendocs_step response <= 50 tokens', async () => {
  const fetchImpl = routedFetch({
    assets: () =>
      new Response(JSON.stringify({ id: 'asset_1', url: 'https://x/asset_1', expires_at: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    steps: () =>
      new Response(JSON.stringify({ order: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });

  const result = await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      action: 'click',
      session_id: 'run_1',
    },
  });

  const content = result.content as Array<{ type: string; text: string }>;
  expect(estimatedTokens(content[0]!.text)).toBeLessThanOrEqual(50);
});

test('opendocs_compile error response <= 50 tokens', async () => {
  const fetchImpl = stubFetch(
    { error: { code: 'internal_error', message: 'boom'.repeat(200) } },
    500
  );
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });

  const result = await client.callTool({
    name: 'opendocs_compile',
    arguments: { session_id: 'run_1' },
  });

  const content = result.content as Array<{ type: string; text: string }>;
  expect(result.isError).toBe(true);
  expect(estimatedTokens(content[0]!.text)).toBeLessThanOrEqual(50);
});

test('missing credentials returns one-line error', async () => {
  const client = await connect({ readKey: async () => null, fetch: stubFetch({}, 500) });

  const result = await client.callTool({
    name: 'opendocs_snap',
    arguments: { file_path: imagePath },
  });

  const content = result.content as Array<{ type: string; text: string }>;
  expect(result.isError).toBe(true);
  expect(content[0]!.text).toBe('not logged in: run opendocs login --key <key>');
  expect(content[0]!.text.includes('\n')).toBe(false);
});

test('first step without session_id creates a run', async () => {
  let sawCreateRun = false;
  const fetchImpl = routedFetch({
    runs: () => {
      sawCreateRun = true;
      return new Response(JSON.stringify({ session_id: 'run_new' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
    assets: () =>
      new Response(JSON.stringify({ id: 'asset_1', url: 'https://x/asset_1', expires_at: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    steps: () =>
      new Response(JSON.stringify({ order: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });

  const result = await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      action: 'click',
    },
  });

  const content = result.content as Array<{ type: string; text: string }>;
  expect(sawCreateRun).toBe(true);
  expect(content[0]!.text).toBe('session_id=run_new step=1');
});

test('stdio server answers tools/list and stays up until stdin closes', async () => {
  const proc = Bun.spawn(['bun', `${import.meta.dir}/main.ts`, 'mcp'], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const send = (message: object) => proc.stdin.write(`${JSON.stringify(message)}\n`);
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
  });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  await proc.stdin.flush();

  const reader = proc.stdout.getReader();
  let buffered = '';
  let tools: string[] | undefined;
  while (!tools) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += new TextDecoder().decode(value);
    for (const line of buffered.split('\n')) {
      if (!line.trim()) continue;
      const message = JSON.parse(line) as { id?: number; result?: { tools?: { name: string }[] } };
      if (message.id === 2) tools = message.result?.tools?.map((tool) => tool.name);
    }
  }

  expect(tools).toEqual(['opendocs_snap', 'opendocs_step', 'opendocs_compile']);
  proc.stdin.end();
  expect(await proc.exited).toBe(0);
}, 15000);

test('rejects bad arguments with one-line errors and no API call', async () => {
  let calls = 0;
  const fetchImpl: FetchLike = async () => {
    calls += 1;
    return new Response('{}', { status: 500 });
  };
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });
  const bad = [
    { name: 'opendocs_step', arguments: { file_path: imagePath, instruction: 'x', action: 'hover' } },
    { name: 'opendocs_step', arguments: { file_path: imagePath, instruction: '', action: 'click' } },
    { name: 'opendocs_step', arguments: { file_path: imagePath, instruction: 'x', action: 'click', box: { x: 1, y: 1, w: 'wide', h: 1 } } },
    { name: 'opendocs_snap', arguments: { file_path: imagePath, ttl: '2d' } },
    { name: 'opendocs_compile', arguments: {} },
  ];

  for (const call of bad) {
    const result = await client.callTool(call);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(result.isError).toBe(true);
    expect(text).not.toContain('\n');
    expect(estimatedTokens(text)).toBeLessThanOrEqual(50);
  }
  expect(calls).toBe(0);
});

test('encodes session_id in the request path', async () => {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    urls.push(url);
    return new Response(JSON.stringify({ url: 'https://x/d/1' }), { status: 200 });
  };
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });

  await client.callTool({ name: 'opendocs_compile', arguments: { session_id: '../me?x=1' } });

  expect(urls[0]).toContain('/runs/..%2Fme%3Fx%3D1/compile');
});
