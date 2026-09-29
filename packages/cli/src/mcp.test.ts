import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { FetchLike } from './api';
import { createMcpServer, type McpDeps } from './mcp';

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
async function connect(deps: McpDeps = {}) {
  const server = createMcpServer({
    loadUserMode: async () => undefined,
    loadAppConfig: async () => ({}),
    cwd: () => '/tmp',
    ...deps,
  });
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

/** Build WebP bytes of the given pixel size from the PNG fixture, for target-box math tests. */
async function resizedWebp(width: number, height: number): Promise<Uint8Array> {
  const fixture = new URL('../test/fixtures/sample.png', import.meta.url);
  const input = await Bun.file(fixture).bytes();
  return await new Bun.Image(input).resize(width, height, { fit: 'fill' }).webp({ quality: 80 }).bytes();
}

/** Recursively collect every JSON-schema `properties` entry missing a `description`. */
function propertiesMissingDescription(schema: unknown, path: string, out: string[]): void {
  if (typeof schema !== 'object' || schema === null) return;
  const s = schema as Record<string, unknown>;
  const properties = s.properties as Record<string, unknown> | undefined;
  if (!properties) return;
  for (const [key, value] of Object.entries(properties)) {
    const propPath = `${path}.${key}`;
    if (typeof value !== 'object' || value === null || !('description' in value)) {
      out.push(propPath);
    }
    propertiesMissingDescription(value, propPath, out);
    const items = (value as Record<string, unknown> | undefined)?.items;
    if (items) propertiesMissingDescription(items, `${propPath}[]`, out);
  }
}

test('instructions are sent on initialize', async () => {
  const server = createMcpServer({
    loadUserMode: async () => undefined,
    loadAppConfig: async () => ({}),
    cwd: () => '/tmp',
  });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  const instructions = client.getInstructions();
  expect(instructions).toBeDefined();
  expect(instructions!.length).toBeGreaterThan(0);
  expect(instructions!.length).toBeLessThanOrEqual(2200);
  expect(instructions).toContain('opendocs_compile');
});

test('instructions say one UI action per step', async () => {
  const server = createMcpServer({
    loadUserMode: async () => undefined,
    loadAppConfig: async () => ({}),
    cwd: () => '/tmp',
  });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  const instructions = client.getInstructions();
  expect(instructions).toContain('One UI action per step');
  expect(instructions).toContain('never write "click X, then Y" in one step');
});

test('instructions forbid URL tricks', async () => {
  const server = createMcpServer({
    loadUserMode: async () => undefined,
    loadAppConfig: async () => ({}),
    cwd: () => '/tmp',
  });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  const instructions = client.getInstructions();
  expect(instructions).toContain('never navigate by editing the URL or adding query params');
});

test('instructions tell install:true after navigation', async () => {
  const server = createMcpServer({
    loadUserMode: async () => undefined,
    loadAppConfig: async () => ({}),
    cwd: () => '/tmp',
  });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  const instructions = client.getInstructions();
  expect(instructions).toContain(
    'After every page load or navigation, call it with install:true directly - don\'t probe first.'
  );
});

test('redaction_script tool description tells install:true after navigation, not probe-first', async () => {
  const client = await connect({ readKey: async () => testKey, fetch: stubFetch({}, 500) });
  const { tools } = await client.listTools();

  const tool = tools.find((t) => t.name === 'opendocs_redaction_script');
  expect(tool?.description).toContain('Call with install:true directly after every page load or navigation');
  expect(tool?.description).not.toContain('Returns a short one-line call by default');
});

test('every input property of every tool has a description', async () => {
  const client = await connect({ readKey: async () => testKey, fetch: stubFetch({}, 500) });
  const { tools } = await client.listTools();

  const missing: string[] = [];
  for (const tool of tools) {
    propertiesMissingDescription(tool.inputSchema, tool.name, missing);
  }
  expect(missing).toEqual([]);
});

test('lists exactly 4 tools', async () => {
  const client = await connect({ readKey: async () => testKey, fetch: stubFetch({}, 500) });
  const { tools } = await client.listTools();

  expect(tools.length).toBe(4);
  expect(tools.map((t) => t.name).sort()).toEqual([
    'opendocs_compile',
    'opendocs_redaction_script',
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
      redact: 'off',
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
      redact: 'off',
    },
  });

  const content = result.content as Array<{ type: string; text: string }>;
  expect(sawCreateRun).toBe(true);
  expect(content[0]!.text).toBe(
    'step 1 recorded, session_id=run_new. Next: next step, or opendocs_compile when done.'
  );
});

test('response notes masked count when PII found', async () => {
  let sentBody: unknown;
  const fetchImpl = routedFetch({
    assets: () =>
      new Response(JSON.stringify({ id: 'asset_1', url: 'https://x/asset_1', expires_at: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    steps: (init) => {
      sentBody = JSON.parse((init as { body: string }).body);
      return new Response(JSON.stringify({ order: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });

  const result = await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Email jane.doe@example.com the receipt',
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
    },
  });

  const content = result.content as Array<{ type: string; text: string }>;
  expect((sentBody as { instruction: string }).instruction).toContain('[email]');
  expect((sentBody as { instruction: string }).instruction).not.toContain('jane.doe@example.com');
  expect(content[0]!.text).toBe(
    'step 1 recorded, session_id=run_1, masked=1. Next: next step, or opendocs_compile when done.'
  );
});

test('response omits the note when none found', async () => {
  let sentBody: unknown;
  const fetchImpl = routedFetch({
    assets: () =>
      new Response(JSON.stringify({ id: 'asset_1', url: 'https://x/asset_1', expires_at: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    steps: (init) => {
      sentBody = JSON.parse((init as { body: string }).body);
      return new Response(JSON.stringify({ order: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });

  const result = await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the blue submit button',
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
    },
  });

  const content = result.content as Array<{ type: string; text: string }>;
  expect((sentBody as { instruction: string }).instruction).toBe('Click the blue submit button');
  expect(content[0]!.text).toBe(
    'step 1 recorded, session_id=run_1. Next: next step, or opendocs_compile when done.'
  );
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

  expect(tools).toEqual([
    'opendocs_redaction_script',
    'opendocs_snap',
    'opendocs_step',
    'opendocs_compile',
  ]);
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

test('step without a report in strict mode is refused before any upload', async () => {
  let calls = 0;
  const fetchImpl: FetchLike = async () => {
    calls += 1;
    return new Response('{}', { status: 500 });
  };
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
  expect(result.isError).toBe(true);
  expect(content[0]!.text).toContain('redact: "strict"');
  expect(calls).toBe(0);
});

test('step forwards the report and mode', async () => {
  let sentBody: unknown;
  const fetchImpl = routedFetch({
    assets: () =>
      new Response(JSON.stringify({ id: 'asset_1', url: 'https://x/asset_1', expires_at: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    steps: (init) => {
      sentBody = JSON.parse((init as { body: string }).body);
      return new Response(JSON.stringify({ order: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });

  await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      action: 'click',
      session_id: 'run_1',
      redact: 'basic',
      redaction_report: { count: 2, script_version: '1' },
    },
  });

  expect(sentBody).toMatchObject({
    redaction: { mode: 'basic', report: { count: 2, script_version: '1' } },
  });
});

test("compile masks PII in the doc title", async () => {
  const bodies: string[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    bodies.push(String((init as { body?: unknown } | undefined)?.body ?? ""));
    return new Response(JSON.stringify({ url: "https://x/d/1" }), { status: 200 });
  };
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });
  const email = ["someone", "example.com"].join("@");

  await client.callTool({ name: "opendocs_compile", arguments: { session_id: "run_1", title: `Guide for ${email}` } });

  expect(bodies.join("")).toContain("[email]");
  expect(bodies.join("")).not.toContain(email);
});

test('redaction_script returns the one-line call by default and the full script with install:true', async () => {
  const client = await connect({ readKey: async () => testKey, fetch: stubFetch({}, 500) });

  const short = await client.callTool({
    name: 'opendocs_redaction_script',
    arguments: { target_text: 'Add to cart' },
  });
  const full = await client.callTool({
    name: 'opendocs_redaction_script',
    arguments: { target_text: 'Add to cart', install: true },
  });

  const shortText = (short.content as Array<{ text: string }>)[0]!.text;
  const fullText = (full.content as Array<{ text: string }>)[0]!.text;
  expect(shortText).toContain('window.__opendocs');
  expect(shortText.length).toBeLessThan(fullText.length);
  expect(fullText).toContain('window.__opendocs = { version:');
});

test('full script from opendocs_redaction_script is minified (no leading indentation lines)', async () => {
  const client = await connect({ readKey: async () => testKey, fetch: stubFetch({}, 500) });

  const full = await client.callTool({
    name: 'opendocs_redaction_script',
    arguments: { install: true },
  });

  const fullText = (full.content as Array<{ text: string }>)[0]!.text;
  expect(fullText.includes('\n')).toBe(false);
  expect(fullText.includes('  ')).toBe(false);
});

test('target box scales x2 for 2560px image of 1280px viewport', async () => {
  let sentBody: unknown;
  const webp = await resizedWebp(2560, 1600);
  await Bun.write(imagePath, webp);
  const fetchImpl = routedFetch({
    assets: () =>
      new Response(JSON.stringify({ id: 'asset_1', url: 'https://x/asset_1', expires_at: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    steps: (init) => {
      sentBody = JSON.parse((init as { body: string }).body);
      return new Response(JSON.stringify({ order: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });

  await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
      redaction_report: {
        count: 0,
        script_version: '2',
        target: { x: 100, y: 50, w: 40, h: 20, vw: 1280, vh: 800, sx: 0, sy: 0 },
      },
    },
  });

  expect((sentBody as { box: unknown }).box).toEqual({ x: 200, y: 100, w: 80, h: 40 });
});

test('full-page image adds scroll offset', async () => {
  let sentBody: unknown;
  const webp = await resizedWebp(1280, 3200);
  await Bun.write(imagePath, webp);
  const fetchImpl = routedFetch({
    assets: () =>
      new Response(JSON.stringify({ id: 'asset_1', url: 'https://x/asset_1', expires_at: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    steps: (init) => {
      sentBody = JSON.parse((init as { body: string }).body);
      return new Response(JSON.stringify({ order: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });

  await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
      redaction_report: {
        count: 0,
        script_version: '2',
        target: { x: 100, y: 50, w: 40, h: 20, vw: 1280, vh: 800, sx: 0, sy: 300 },
      },
    },
  });

  expect((sentBody as { box: unknown }).box).toEqual({ x: 100, y: 350, w: 40, h: 20 });
});

test('explicit box wins over a target in the report', async () => {
  let sentBody: unknown;
  const webp = await resizedWebp(2560, 1600);
  await Bun.write(imagePath, webp);
  const fetchImpl = routedFetch({
    assets: () =>
      new Response(JSON.stringify({ id: 'asset_1', url: 'https://x/asset_1', expires_at: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    steps: (init) => {
      sentBody = JSON.parse((init as { body: string }).body);
      return new Response(JSON.stringify({ order: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });

  await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
      box: { x: 5, y: 6, w: 7, h: 8 },
      redaction_report: {
        count: 0,
        script_version: '2',
        target: { x: 100, y: 50, w: 40, h: 20, vw: 1280, vh: 800, sx: 0, sy: 0 },
      },
    },
  });

  expect((sentBody as { box: unknown }).box).toEqual({ x: 5, y: 6, w: 7, h: 8 });
});

test('no target in the report stores no box', async () => {
  let sentBody: unknown;
  const fetchImpl = routedFetch({
    assets: () =>
      new Response(JSON.stringify({ id: 'asset_1', url: 'https://x/asset_1', expires_at: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    steps: (init) => {
      sentBody = JSON.parse((init as { body: string }).body);
      return new Response(JSON.stringify({ order: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });

  await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
      redaction_report: { count: 0, script_version: '2' },
    },
  });

  expect((sentBody as { box?: unknown }).box).toBeUndefined();
});

test('target and target_error are stripped from the report before sending to the API', async () => {
  let sentBody: unknown;
  const webp = await resizedWebp(2560, 1600);
  await Bun.write(imagePath, webp);
  const fetchImpl = routedFetch({
    assets: () =>
      new Response(JSON.stringify({ id: 'asset_1', url: 'https://x/asset_1', expires_at: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    steps: (init) => {
      sentBody = JSON.parse((init as { body: string }).body);
      return new Response(JSON.stringify({ order: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });

  await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      action: 'click',
      session_id: 'run_1',
      redact: 'basic',
      redaction_report: {
        count: 0,
        script_version: '2',
        target: { x: 100, y: 50, w: 40, h: 20, vw: 1280, vh: 800, sx: 0, sy: 0 },
      },
    },
  });

  const report = (sentBody as { redaction: { report?: Record<string, unknown> } }).redaction.report;
  expect(report).toEqual({ count: 0, script_version: '2', boxes: undefined });
  expect(report?.target).toBeUndefined();
  expect(report?.target_error).toBeUndefined();
});

test('step result says no highlight with the reason when target_error is set', async () => {
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
      redact: 'off',
      redaction_report: { count: 0, script_version: '3', target_error: 'target outside the viewport' },
    },
  });

  const text = (result.content as Array<{ text: string }>)[0]!.text;
  expect(text).toBe(
    'step 1 recorded, session_id=run_1, no highlight (target outside the viewport). Next: next step, or opendocs_compile when done.'
  );
});

test('step result says no highlight when a target box clamps to zero area', async () => {
  const webp = await resizedWebp(1280, 800);
  await Bun.write(imagePath, webp);
  const fetchImpl = routedFetch({
    assets: () =>
      new Response(JSON.stringify({ id: 'asset_1', url: 'https://x/asset_1', expires_at: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    steps: (init) => {
      // capture and pass through so we can inspect the highlight-free text
      JSON.parse((init as { body: string }).body);
      return new Response(JSON.stringify({ order: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });

  const result = await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
      redaction_report: {
        count: 0,
        script_version: '3',
        target: { x: 1280, y: 50, w: 40, h: 20, vw: 1280, vh: 800, sx: 0, sy: 0 },
      },
    },
  });

  const text = (result.content as Array<{ text: string }>)[0]!.text;
  expect(text).toBe(
    'step 1 recorded, session_id=run_1, no highlight (target outside the screenshot). Next: next step, or opendocs_compile when done.'
  );
});

test('no-highlight step result stays within the token cap', async () => {
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
      redact: 'off',
      redaction_report: {
        count: 0,
        script_version: '3',
        target_error:
          'not found: a very long target text that could in principle blow past the fifty token response cap',
      },
    },
  });

  const text = (result.content as Array<{ text: string }>)[0]!.text;
  expect(estimatedTokens(text)).toBeLessThanOrEqual(50);
});
