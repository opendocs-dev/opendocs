import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { FetchLike } from './api';
import { createMcpServer, type McpDeps } from './mcp';
import { computeReportSig } from './redact/hash';

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

/** Call opendocs_redaction_script and pull the nonce baked into the returned source. */
async function issueNonce(client: Client): Promise<string> {
  const result = await client.callTool({ name: 'opendocs_redaction_script', arguments: {} });
  const src = (result.content as Array<{ text: string }>)[0]!.text;
  const match = src.match(/"nonce":"([^"]+)"/);
  if (!match) throw new Error(`no nonce found in redaction script source: ${src}`);
  return match[1]!;
}

interface ReportFields {
  count?: number;
  script_version?: string;
  boxes?: Array<{ x: number; y: number; w: number; h: number }>;
  target?: { x: number; y: number; w: number; h: number; vw: number; vh: number; sx: number; sy: number };
  target_error?: string;
  viewport?: { w: number; h: number; dpr: number };
  iframes?: number;
}

/** Build a `redaction_report` signed for `nonce`, as the real script would return. */
function signedReport(nonce: string, fields: ReportFields = {}) {
  const count = fields.count ?? 0;
  const boxes = fields.boxes;
  const target = fields.target;
  const targetError = fields.target_error;
  const viewport = fields.viewport;
  const iframes = fields.iframes;
  const sig = computeReportSig(nonce, count, boxes, target, targetError, viewport, iframes);
  return {
    count,
    script_version: '6',
    ...(boxes !== undefined ? { boxes } : {}),
    ...(target !== undefined ? { target } : {}),
    ...(targetError !== undefined ? { target_error: targetError } : {}),
    ...(viewport !== undefined ? { viewport } : {}),
    ...(iframes !== undefined ? { iframes } : {}),
    nonce,
    sig,
  };
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

test('lists exactly 5 tools', async () => {
  const client = await connect({ readKey: async () => testKey, fetch: stubFetch({}, 500) });
  const { tools } = await client.listTools();

  expect(tools.length).toBe(5);
  expect(tools.map((t) => t.name).sort()).toEqual([
    'opendocs_categories',
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
    'step 1 recorded, session_id=run_new. Next: next step, or opendocs_compile when done. ' +
      'add title and alt next time.'
  );
});

test('run_title on the first step goes to createRun, not the step; step title stays on the step', async () => {
  let runBody: unknown;
  let stepBody: unknown;
  const fetchImpl = routedFetch({
    runs: (init) => {
      runBody = JSON.parse((init as { body: string }).body);
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
    steps: (init) => {
      stepBody = JSON.parse((init as { body: string }).body);
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
      title: 'Open Isi Saldo',
      run_title: 'Isi Saldo Guide',
      action: 'click',
      redact: 'off',
    },
  });

  expect((runBody as { title?: string }).title).toBe('Isi Saldo Guide');
  expect((stepBody as { title?: string }).title).toBe('Open Isi Saldo');
  expect((stepBody as Record<string, unknown>).run_title).toBeUndefined();
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
    'step 1 recorded, session_id=run_1, masked=1. Next: next step, or opendocs_compile when done. ' +
      'add title and alt next time.'
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
    'step 1 recorded, session_id=run_1. Next: next step, or opendocs_compile when done. ' +
      'add title and alt next time.'
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
    'opendocs_categories',
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
    {
      name: 'opendocs_step',
      arguments: {
        file_path: imagePath,
        instruction: 'x',
        action: 'click',
        redaction_report: { count: 'nope', script_version: '6', nonce: 'n', sig: 's' },
      },
    },
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
  const nonce = await issueNonce(client);

  await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      action: 'click',
      session_id: 'run_1',
      redact: 'basic',
      redaction_report: signedReport(nonce, { count: 2 }),
    },
  });

  expect(sentBody).toMatchObject({
    redaction: { mode: 'basic', report: { count: 2, script_version: '6' } },
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
  const nonce = await issueNonce(client);

  await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
      redaction_report: signedReport(nonce, {
        target: { x: 100, y: 50, w: 40, h: 20, vw: 1280, vh: 800, sx: 0, sy: 0 },
      }),
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
  const nonce = await issueNonce(client);

  await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
      redaction_report: signedReport(nonce, {
        target: { x: 100, y: 50, w: 40, h: 20, vw: 1280, vh: 800, sx: 0, sy: 300 },
      }),
    },
  });

  expect((sentBody as { box: unknown }).box).toEqual({ x: 100, y: 350, w: 40, h: 20 });
});

test('box input no longer accepted in the schema', async () => {
  const client = await connect({ readKey: async () => testKey, fetch: stubFetch({}, 500) });
  const nonce = await issueNonce(client);

  const stepResult = await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
      box: { x: 5, y: 6, w: 7, h: 8 },
      redaction_report: signedReport(nonce),
    },
  });
  expect(stepResult.isError).toBe(true);

  const snapResult = await client.callTool({
    name: 'opendocs_snap',
    arguments: { file_path: imagePath, redact: 'off', box: { x: 5, y: 6, w: 7, h: 8 } },
  });
  expect(snapResult.isError).toBe(true);
});

test('valid report accepted and target converted to box', async () => {
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
  const nonce = await issueNonce(client);

  const result = await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
      redaction_report: signedReport(nonce, {
        target: { x: 100, y: 50, w: 40, h: 20, vw: 1280, vh: 800, sx: 0, sy: 0 },
      }),
    },
  });

  expect(result.isError).toBeUndefined();
  expect((sentBody as { box: unknown }).box).toEqual({ x: 200, y: 100, w: 80, h: 40 });
});

test('report with unknown nonce rejected, nothing uploaded', async () => {
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
      redact: 'off',
      redaction_report: signedReport('never-issued-nonce'),
    },
  });

  const content = result.content as Array<{ type: string; text: string }>;
  expect(result.isError).toBe(true);
  expect(content[0]!.text).toBe(
    'redaction_report must be passed exactly as the script returned it; run opendocs_redaction_script again'
  );
  expect(calls).toBe(0);
});

test('reused nonce rejected', async () => {
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
  const nonce = await issueNonce(client);
  const report = signedReport(nonce);

  const first = await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
      redaction_report: report,
    },
  });
  expect(first.isError).toBeUndefined();

  const second = await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click another button',
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
      redaction_report: report,
    },
  });

  const content = second.content as Array<{ type: string; text: string }>;
  expect(second.isError).toBe(true);
  expect(content[0]!.text).toBe(
    'redaction_report must be passed exactly as the script returned it; run opendocs_redaction_script again'
  );
});

test('edited target (sig mismatch) rejected', async () => {
  let calls = 0;
  const fetchImpl: FetchLike = async () => {
    calls += 1;
    return new Response('{}', { status: 500 });
  };
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });
  const nonce = await issueNonce(client);
  const report = signedReport(nonce, {
    target: { x: 494, y: 154, w: 292, h: 37, vw: 1280, vh: 800, sx: 0, sy: 0 },
  });
  // An agent editing the target after the fact - the signature no longer matches.
  const tampered = { ...report, target: { ...report.target, x: 0, y: 0, w: 100, h: 30 } };

  const result = await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
      redaction_report: tampered,
    },
  });

  const content = result.content as Array<{ type: string; text: string }>;
  expect(result.isError).toBe(true);
  expect(content[0]!.text).toBe(
    'redaction_report must be passed exactly as the script returned it; run opendocs_redaction_script again'
  );
  expect(calls).toBe(0);
});

test('nonce/sig stripped before API call', async () => {
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
  const nonce = await issueNonce(client);

  await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      action: 'click',
      session_id: 'run_1',
      redact: 'basic',
      redaction_report: signedReport(nonce),
    },
  });

  const report = (sentBody as { redaction: { report?: Record<string, unknown> } }).redaction.report;
  expect(report?.nonce).toBeUndefined();
  expect(report?.sig).toBeUndefined();
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
  const nonce = await issueNonce(client);

  await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
      redaction_report: signedReport(nonce),
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
  const nonce = await issueNonce(client);

  await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      action: 'click',
      session_id: 'run_1',
      redact: 'basic',
      redaction_report: signedReport(nonce, {
        target: { x: 100, y: 50, w: 40, h: 20, vw: 1280, vh: 800, sx: 0, sy: 0 },
      }),
    },
  });

  const report = (sentBody as { redaction: { report?: Record<string, unknown> } }).redaction.report;
  expect(report).toEqual({
    count: 0,
    script_version: '6',
    boxes: undefined,
    viewport: undefined,
    iframes: undefined,
  });
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
  const nonce = await issueNonce(client);

  const result = await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
      redaction_report: signedReport(nonce, { target_error: 'target outside the viewport' }),
    },
  });

  const text = (result.content as Array<{ text: string }>)[0]!.text;
  expect(text).toBe(
    'step 1 recorded, session_id=run_1, no highlight (target outside the viewport). ' +
      'Next: next step, or opendocs_compile when done. add title and alt next time.'
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
  const nonce = await issueNonce(client);

  const result = await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
      redaction_report: signedReport(nonce, {
        target: { x: 1280, y: 50, w: 40, h: 20, vw: 1280, vh: 800, sx: 0, sy: 0 },
      }),
    },
  });

  const text = (result.content as Array<{ text: string }>)[0]!.text;
  expect(text).toBe(
    'step 1 recorded, session_id=run_1, no highlight (target outside the screenshot). ' +
      'Next: next step, or opendocs_compile when done. add title and alt next time.'
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
  const nonce = await issueNonce(client);
  const targetError = 'not found: a very long target text that could in principle blow past the fifty token response cap';

  const result = await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
      redaction_report: signedReport(nonce, { target_error: targetError }),
    },
  });

  const text = (result.content as Array<{ text: string }>)[0]!.text;
  expect(estimatedTokens(text)).toBeLessThanOrEqual(50);
});

test('title and alt are masked and forwarded', async () => {
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
  const email = ['someone', 'example.com'].join('@');

  await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      title: 'Open Isi Saldo',
      alt: `Screen showing ${email} in the header`,
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
    },
  });

  expect((sentBody as { title: string }).title).toBe('Open Isi Saldo');
  expect((sentBody as { alt: string }).alt).toContain('[email]');
  expect((sentBody as { alt: string }).alt).not.toContain(email);
});

test('over-cap title rejected before upload', async () => {
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
      title: 'x'.repeat(61),
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
    },
  });

  const content = result.content as Array<{ type: string; text: string }>;
  expect(result.isError).toBe(true);
  expect(content[0]!.text).toContain('title must be at most 60 chars');
  expect(calls).toBe(0);
});

test('over-cap alt rejected before upload', async () => {
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
      alt: 'x'.repeat(301),
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
    },
  });

  const content = result.content as Array<{ type: string; text: string }>;
  expect(result.isError).toBe(true);
  expect(content[0]!.text).toContain('alt must be at most 300 chars');
  expect(calls).toBe(0);
});

test('missing title/alt nudges say exactly what is missing, present title and alt do not nudge', async () => {
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

  const withTitleAndAlt = await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      title: 'Open Isi Saldo',
      alt: 'The home screen showing the balance button.',
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
    },
  });
  const withTitleAndAltText = (withTitleAndAlt.content as Array<{ text: string }>)[0]!.text;
  expect(withTitleAndAltText).not.toContain('add title');
  expect(withTitleAndAltText).not.toContain('add alt');

  const withoutTitle = await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      alt: 'The home screen showing the balance button.',
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
    },
  });
  const withoutTitleText = (withoutTitle.content as Array<{ text: string }>)[0]!.text;
  expect(withoutTitleText).toContain('add title next time');
  expect(withoutTitleText).not.toContain('add alt');
  expect(withoutTitleText).not.toContain('add title and alt');

  const withoutAlt = await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      title: 'Open Isi Saldo',
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
    },
  });
  const withoutAltText = (withoutAlt.content as Array<{ text: string }>)[0]!.text;
  expect(withoutAltText).toContain('add alt next time');
  expect(withoutAltText).not.toContain('add title next time');
  expect(withoutAltText).not.toContain('add title and alt');

  const withoutBoth = await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
    },
  });
  const withoutBothText = (withoutBoth.content as Array<{ text: string }>)[0]!.text;
  expect(withoutBothText).toContain('add title and alt next time');
});

test('wide viewport adds the resize hint', async () => {
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
  const nonce = await issueNonce(client);

  const result = await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      title: 'Open Isi Saldo',
      alt: 'The home screen showing the balance button.',
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
      redaction_report: signedReport(nonce, { viewport: { w: 1920, h: 1080, dpr: 1 } }),
    },
  });

  const text = (result.content as Array<{ text: string }>)[0]!.text;
  expect(text).toContain('page is 1920px wide: resize the viewport to 1280x800 before the next step');
});

test('1280 wide adds no hint', async () => {
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
  const nonce = await issueNonce(client);

  const result = await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      title: 'Open Isi Saldo',
      alt: 'The home screen showing the balance button.',
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
      redaction_report: signedReport(nonce, { viewport: { w: 1280, h: 800, dpr: 2 } }),
    },
  });

  const text = (result.content as Array<{ text: string }>)[0]!.text;
  expect(text).not.toContain('resize the viewport');
});

test('iframe line in the step result', async () => {
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
  const nonce = await issueNonce(client);

  const result = await client.callTool({
    name: 'opendocs_step',
    arguments: {
      file_path: imagePath,
      instruction: 'Click the button',
      title: 'Open Isi Saldo',
      alt: 'The home screen showing the balance button.',
      action: 'click',
      session_id: 'run_1',
      redact: 'off',
      redaction_report: signedReport(nonce, { viewport: { w: 1280, h: 800, dpr: 2 }, iframes: 2 }),
    },
  });

  const text = (result.content as Array<{ text: string }>)[0]!.text;
  expect(text).toContain('2 cross-origin iframe(s) on screen: not redacted, no highlight inside');
});

test('opendocs_snap gets the same viewport and iframe lines', async () => {
  const fetchImpl = stubFetch({ id: 'asset_1', url: 'https://x/asset_1', expires_at: null }, 200);
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });
  const nonce = await issueNonce(client);

  const result = await client.callTool({
    name: 'opendocs_snap',
    arguments: {
      file_path: imagePath,
      redact: 'off',
      redaction_report: signedReport(nonce, { viewport: { w: 1920, h: 1080, dpr: 1 }, iframes: 1 }),
    },
  });

  const text = (result.content as Array<{ text: string }>)[0]!.text;
  expect(text).toContain('page is 1920px wide: resize the viewport to 1280x800 before the next step');
  expect(text).toContain('1 cross-origin iframe(s) on screen: not redacted, no highlight inside');
});

test('compile with category and summary sends them in the JSON body', async () => {
  let sawBody: unknown;
  const fetchImpl = routedFetch({
    compile: (init) => {
      sawBody = JSON.parse((init as { body: string }).body);
      return new Response(JSON.stringify({ url: '/d/compiled1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });

  const result = await client.callTool({
    name: 'opendocs_compile',
    arguments: { session_id: 'run_1', category: 'WhatsApp', summary: 'How to send a message' },
  });

  expect(sawBody).toEqual({ category: 'WhatsApp', summary: 'How to send a message' });
  const text = (result.content as Array<{ text: string }>)[0]!.text;
  expect(text).toBe('/d/compiled1');
});

test('compile with category containing email masks the email in sent body', async () => {
  let sawBody: unknown;
  const fetchImpl = routedFetch({
    compile: (init) => {
      sawBody = JSON.parse((init as { body: string }).body);
      return new Response(JSON.stringify({ url: '/d/compiled2' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });

  const result = await client.callTool({
    name: 'opendocs_compile',
    arguments: { session_id: 'run_1', category: 'user@example.com' },
  });

  const body = sawBody as Record<string, unknown>;
  expect(body.category).not.toBe('user@example.com');
  expect(typeof body.category).toBe('string');
  expect((body.category as string).length).toBeGreaterThan(0);
});

test('compile rejects category of 41 chars and empty summary', async () => {
  let fetchCalled = false;
  const fetchImpl = routedFetch({
    compile: () => {
      fetchCalled = true;
      return new Response(JSON.stringify({ url: '/d/compiled3' }), { status: 200 });
    },
  });
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });

  const result = await client.callTool({
    name: 'opendocs_compile',
    arguments: { session_id: 'run_1', category: 'x'.repeat(41) },
  });

  expect(fetchCalled).toBe(false);
  const text = (result.content as Array<{ text: string }>)[0]!.text;
  expect(text).toBe('category must be 1-40 characters');
  expect(result.isError).toBe(true);
});

test('compile with empty summary rejects it', async () => {
  let fetchCalled = false;
  const fetchImpl = routedFetch({
    compile: () => {
      fetchCalled = true;
      return new Response(JSON.stringify({ url: '/d/compiled4' }), { status: 200 });
    },
  });
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });

  const result = await client.callTool({
    name: 'opendocs_compile',
    arguments: { session_id: 'run_1', summary: '  ' },
  });

  expect(fetchCalled).toBe(false);
  const text = (result.content as Array<{ text: string }>)[0]!.text;
  expect(text).toBe('summary must be 1-300 characters');
  expect(result.isError).toBe(true);
});

test('compile appends suggestion sentence when category_status is suggested', async () => {
  const fetchImpl = routedFetch({
    compile: () =>
      new Response(JSON.stringify({ url: '/d/compiled5', category_status: 'suggested' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });

  const result = await client.callTool({
    name: 'opendocs_compile',
    arguments: { session_id: 'run_1', category: 'NewCategory' },
  });

  const text = (result.content as Array<{ text: string }>)[0]!.text;
  expect(text).toContain('/d/compiled5');
  expect(text).toContain('Category "NewCategory" is a suggestion until the owner accepts it.');
});

test('compile appends cap limit sentence when category_status is cap_reached', async () => {
  const fetchImpl = routedFetch({
    compile: () =>
      new Response(JSON.stringify({ url: '/d/compiled6', category_status: 'cap_reached' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });

  const result = await client.callTool({
    name: 'opendocs_compile',
    arguments: { session_id: 'run_1', category: 'CapReached' },
  });

  const text = (result.content as Array<{ text: string }>)[0]!.text;
  expect(text).toContain('/d/compiled6');
  expect(text).toContain('The category limit is reached, so the guide has no category.');
});

test('compile does not append status message when category_status is filed or none', async () => {
  const fetchImpl = routedFetch({
    compile: () =>
      new Response(JSON.stringify({ url: '/d/compiled7', category_status: 'filed' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });

  const result = await client.callTool({
    name: 'opendocs_compile',
    arguments: { session_id: 'run_1', category: 'Filed' },
  });

  const text = (result.content as Array<{ text: string }>)[0]!.text;
  expect(text).toBe('/d/compiled7');
});

test('opendocs_categories returns categories formatted as name: description', async () => {
  const fetchImpl = stubFetch(
    {
      categories: [
        { id: 'cat_1', slug: 'whatsapp', name: 'WhatsApp', description: 'WhatsApp guides', status: 'active', guides: 5 },
        { id: 'cat_2', slug: 'slack', name: 'Slack', description: '', status: 'active', guides: 3 },
        { id: 'cat_3', slug: 'telegram', name: 'Telegram', description: 'Telegram integration', status: 'suggested', guides: 0 },
      ],
    },
    200
  );
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });

  const result = await client.callTool({ name: 'opendocs_categories', arguments: {} });

  const text = (result.content as Array<{ text: string }>)[0]!.text;
  expect(text).toContain('WhatsApp: WhatsApp guides');
  expect(text).toContain('Slack');
  expect(text).not.toContain('Slack:');
  expect(text).toContain('Telegram: Telegram integration (suggested)');
});

test('opendocs_categories returns empty message when list is empty', async () => {
  const fetchImpl = stubFetch({ categories: [] }, 200);
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });

  const result = await client.callTool({ name: 'opendocs_categories', arguments: {} });

  const text = (result.content as Array<{ text: string }>)[0]!.text;
  expect(text).toBe('No categories yet. Choose a short name; the owner may review it.');
});

test('opendocs_categories caps at 30 lines', async () => {
  const categories = Array.from({ length: 40 }, (_, i) => ({
    id: `cat_${i}`,
    slug: `cat${i}`,
    name: `Category ${i}`,
    description: `Description ${i}`,
    status: 'active' as const,
    guides: i,
  }));
  const fetchImpl = stubFetch({ categories }, 200);
  const client = await connect({ readKey: async () => testKey, fetch: fetchImpl });

  const result = await client.callTool({ name: 'opendocs_categories', arguments: {} });

  const text = (result.content as Array<{ text: string }>)[0]!.text;
  const lines = text.split('\n');
  expect(lines.length).toBe(30);
});

test('opendocs_categories returns not-logged-in error without key', async () => {
  const fetchImpl = stubFetch({}, 500);
  const client = await connect({ readKey: async () => null, fetch: fetchImpl });

  const result = await client.callTool({ name: 'opendocs_categories', arguments: {} });

  const text = (result.content as Array<{ text: string }>)[0]!.text;
  expect(text).toBe('not logged in: run opendocs login --key <key>');
  expect(result.isError).toBe(true);
});

test('the compile tool description points the agent at opendocs_categories', async () => {
  const server = createMcpServer({
    loadUserMode: async () => undefined,
    loadAppConfig: async () => ({}),
    cwd: () => '/tmp',
  });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  const { tools } = await client.listTools();
  const compile = tools.find((tool) => tool.name === 'opendocs_compile');
  expect(compile?.description).toContain('opendocs_categories');
});
