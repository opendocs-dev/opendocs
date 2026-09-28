/**
 * OpenDocs MCP server: exposes snap/step/compile as tools over stdio.
 *
 * Every tool result goes through {@link toCompactText} so a step's text stays
 * short for the calling model's context, and nothing but the JSON-RPC protocol
 * ever reaches stdout - all diagnostics go to stderr.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { AddStepBody, Box } from '@opendocs/core/contract';
import { SNAP_TTL_VALUES, type SnapTtl } from '@opendocs/core/limits';
import type { ApiFailureKind, FetchLike } from './api';
import { addStep, compileRun, createRun } from './api';
import { readCredentials } from './config';
import { uploadImage } from './upload';
import pkg from '../package.json' with { type: 'json' };

/** Collaborators for {@link createMcpServer}, injected so tests avoid real I/O. */
export interface McpDeps {
  fetch?: FetchLike;
  readKey?: () => Promise<string | null>;
}

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: true };

/**
 * Compact a result/error string to a single line, capped near 50 tokens.
 *
 * @param text Raw text.
 * @returns One line; truncated to 197 chars + an ellipsis when its rough token
 *   estimate (`ceil(length / 4)`) exceeds 50.
 */
export function toCompactText(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  const estimatedTokens = Math.ceil(oneLine.length / 4);
  if (estimatedTokens > 50) {
    return `${oneLine.slice(0, 197)}…`;
  }
  return oneLine;
}

function textResult(text: string, isError?: true): ToolResult {
  const result: ToolResult = { content: [{ type: 'text', text: toCompactText(text) }] };
  if (isError) result.isError = true;
  return result;
}

/** Map an API failure kind to the one-line message the tool should return. */
function mapApiError(result: { kind: ApiFailureKind; message: string }): string {
  if (result.kind === 'unauthorized') return 'API key rejected: run opendocs login again';
  if (result.kind === 'network') return 'cannot reach OpenDocs API';
  return result.message;
}

const NOT_LOGGED_IN = 'not logged in: run opendocs login --key <key>';

const SNAP_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    file_path: { type: 'string' },
    ttl: { type: 'string', enum: [...SNAP_TTL_VALUES] },
  },
  required: ['file_path'],
  additionalProperties: false,
} as const;

const BOX_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
    w: { type: 'number' },
    h: { type: 'number' },
  },
  required: ['x', 'y', 'w', 'h'],
  additionalProperties: false,
} as const;

const STEP_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    file_path: { type: 'string' },
    instruction: { type: 'string' },
    action: { type: 'string', enum: ['click', 'type', 'navigate', 'other'] },
    selector: { type: 'string' },
    box: BOX_INPUT_SCHEMA,
    page_url: { type: 'string' },
    session_id: { type: 'string' },
    title: { type: 'string' },
  },
  required: ['file_path', 'instruction', 'action'],
  additionalProperties: false,
} as const;

const COMPILE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    session_id: { type: 'string' },
    title: { type: 'string' },
  },
  required: ['session_id'],
  additionalProperties: false,
} as const;

interface SnapArgs {
  file_path: string;
  ttl?: SnapTtl;
}

/** Validate raw `opendocs_snap` arguments, or return a one-line error. */
function parseSnapArgs(args: unknown): SnapArgs | string {
  if (typeof args !== 'object' || args === null) return 'invalid arguments';
  const a = args as Record<string, unknown>;
  if (typeof a.file_path !== 'string' || a.file_path.length === 0) return 'file_path is required';
  if (a.ttl !== undefined && !(SNAP_TTL_VALUES as readonly string[]).includes(a.ttl as string)) {
    return 'ttl must be one of 15m, 1h, 24h';
  }
  return { file_path: a.file_path, ttl: a.ttl as SnapTtl | undefined };
}

/** Validate a `box` field, or return a one-line error. */
function parseBox(value: unknown): Box | undefined | string {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) return 'box must be an object';
  const b = value as Record<string, unknown>;
  for (const key of ['x', 'y', 'w', 'h'] as const) {
    if (typeof b[key] !== 'number' || !Number.isFinite(b[key])) return `box.${key} must be a finite number`;
  }
  return { x: b.x as number, y: b.y as number, w: b.w as number, h: b.h as number };
}

const STEP_ACTIONS = ['click', 'type', 'navigate', 'other'] as const;
type StepAction = (typeof STEP_ACTIONS)[number];

interface StepArgs {
  file_path: string;
  instruction: string;
  action: StepAction;
  selector?: string;
  box?: Box;
  page_url?: string;
  session_id?: string;
  title?: string;
}

/** Validate raw `opendocs_step` arguments, or return a one-line error. */
function parseStepArgs(args: unknown): StepArgs | string {
  if (typeof args !== 'object' || args === null) return 'invalid arguments';
  const a = args as Record<string, unknown>;
  if (typeof a.file_path !== 'string' || a.file_path.length === 0) return 'file_path is required';
  if (typeof a.instruction !== 'string' || a.instruction.length === 0) return 'instruction is required';
  if (typeof a.action !== 'string' || !(STEP_ACTIONS as readonly string[]).includes(a.action)) {
    return 'action must be one of click, type, navigate, other';
  }
  if (a.selector !== undefined && typeof a.selector !== 'string') return 'selector must be a string';
  const box = parseBox(a.box);
  if (typeof box === 'string') return box;
  if (a.page_url !== undefined && typeof a.page_url !== 'string') return 'page_url must be a string';
  if (a.session_id !== undefined && typeof a.session_id !== 'string') return 'session_id must be a string';
  if (a.title !== undefined && typeof a.title !== 'string') return 'title must be a string';
  return {
    file_path: a.file_path,
    instruction: a.instruction,
    action: a.action as StepAction,
    selector: a.selector as string | undefined,
    box,
    page_url: a.page_url as string | undefined,
    session_id: a.session_id as string | undefined,
    title: a.title as string | undefined,
  };
}

interface CompileArgs {
  session_id: string;
  title?: string;
}

/** Validate raw `opendocs_compile` arguments, or return a one-line error. */
function parseCompileArgs(args: unknown): CompileArgs | string {
  if (typeof args !== 'object' || args === null) return 'invalid arguments';
  const a = args as Record<string, unknown>;
  if (typeof a.session_id !== 'string' || a.session_id.length === 0) return 'session_id is required';
  if (a.title !== undefined && typeof a.title !== 'string') return 'title must be a string';
  return { session_id: a.session_id, title: a.title as string | undefined };
}

async function handleSnap(
  args: unknown,
  fetchImpl: FetchLike,
  readKey: () => Promise<string | null>
): Promise<ToolResult> {
  const parsed = parseSnapArgs(args);
  if (typeof parsed === 'string') return textResult(parsed, true);

  const key = await readKey();
  if (!key) return textResult(NOT_LOGGED_IN, true);

  const uploaded = await uploadImage(parsed.file_path, key, 'snap', parsed.ttl, fetchImpl);
  if (!uploaded.ok) return textResult(mapApiError(uploaded), true);

  return textResult(`${uploaded.data.url} expires ${uploaded.data.expires_at}`);
}

async function handleStep(
  args: unknown,
  fetchImpl: FetchLike,
  readKey: () => Promise<string | null>
): Promise<ToolResult> {
  const parsed = parseStepArgs(args);
  if (typeof parsed === 'string') return textResult(parsed, true);

  const key = await readKey();
  if (!key) return textResult(NOT_LOGGED_IN, true);

  let sessionId = parsed.session_id;
  if (!sessionId) {
    const run = await createRun(key, parsed.title, fetchImpl);
    if (!run.ok) return textResult(mapApiError(run), true);
    sessionId = run.data.session_id;
  }

  const uploaded = await uploadImage(parsed.file_path, key, 'step', undefined, fetchImpl);
  if (!uploaded.ok) return textResult(mapApiError(uploaded), true);

  const body: AddStepBody = {
    asset_id: uploaded.data.id,
    action: parsed.action,
    instruction: parsed.instruction,
    selector: parsed.selector,
    box: parsed.box,
    page_url: parsed.page_url,
    redaction: { mode: 'off' },
  };

  const step = await addStep(key, sessionId, body, fetchImpl);
  if (!step.ok) return textResult(mapApiError(step), true);

  return textResult(`session_id=${sessionId} step=${step.data.order}`);
}

async function handleCompile(
  args: unknown,
  fetchImpl: FetchLike,
  readKey: () => Promise<string | null>
): Promise<ToolResult> {
  const parsed = parseCompileArgs(args);
  if (typeof parsed === 'string') return textResult(parsed, true);

  const key = await readKey();
  if (!key) return textResult(NOT_LOGGED_IN, true);

  const compiled = await compileRun(key, parsed.session_id, parsed.title, fetchImpl);
  if (!compiled.ok) return textResult(mapApiError(compiled), true);

  return textResult(compiled.data.url);
}

/**
 * Build the MCP server with its tool handlers wired up.
 *
 * @param deps Injectable `fetch` and credential reader, for tests.
 */
export function createMcpServer(deps: McpDeps = {}): Server {
  const fetchImpl = deps.fetch ?? fetch;
  const readKey = deps.readKey ?? readCredentials;

  const server = new Server(
    { name: 'opendocs', version: pkg.version },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'opendocs_snap',
        description: 'Upload a short-lived screenshot and get back its URL.',
        inputSchema: SNAP_INPUT_SCHEMA,
      },
      {
        name: 'opendocs_step',
        description: 'Record one documentation step: uploads an image and adds it to a run.',
        inputSchema: STEP_INPUT_SCHEMA,
      },
      {
        name: 'opendocs_compile',
        description: 'Compile a run into a published doc and get back its URL.',
        inputSchema: COMPILE_INPUT_SCHEMA,
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      switch (name) {
        case 'opendocs_snap':
          return await handleSnap(args, fetchImpl, readKey);
        case 'opendocs_step':
          return await handleStep(args, fetchImpl, readKey);
        case 'opendocs_compile':
          return await handleCompile(args, fetchImpl, readKey);
        default:
          return textResult(`unknown tool: ${name}`, true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return textResult(message, true);
    }
  });

  return server;
}

/** Run the MCP server on stdio until the transport closes. */
export async function startMcp(): Promise<void> {
  const server = createMcpServer();
  // connect() resolves once listening; the caller exits the process when this returns,
  // so wait for the client to go away (stdin closed or transport closed).
  const closed = new Promise<void>((resolve) => {
    server.onclose = () => resolve();
    process.stdin.once('end', () => resolve());
  });
  await server.connect(new StdioServerTransport());
  await closed;
}
