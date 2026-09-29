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
import type { AddStepBody, Box, RedactionReport } from '@opendocs/core/contract';
import { SNAP_TTL_VALUES, type SnapTtl } from '@opendocs/core/limits';
import type { ApiFailureKind, FetchLike } from './api';
import { addStep, compileRun, createRun, uploadAsset } from './api';
import { readCredentials } from './config';
import { maskStepText } from './pii';
import { computeBoxFromTarget, type TargetRect } from './redact/box';
import { loadAppConfig, loadUserMode, requireReport, resolveMode, type RedactMode } from './redact/enforce';
import { buildInstallScript, buildOneLineCall, type RunOptions } from './redact/script';
import { prepareImage, uploadImage } from './upload';
import pkg from '../package.json' with { type: 'json' };

/** Collaborators for {@link createMcpServer}, injected so tests avoid real I/O. */
export interface McpDeps {
  fetch?: FetchLike;
  readKey?: () => Promise<string | null>;
  loadUserMode?: () => Promise<RedactMode | undefined>;
  loadAppConfig?: (cwd: string) => Promise<{ mode?: RedactMode; selectors?: string[]; allow?: string[] }>;
  cwd?: () => string;
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

/** Sent to the client on initialize; kept under ~1800 chars. */
const SERVER_INSTRUCTIONS = `Recording a walkthrough: plan the steps first, then for EACH step, in this exact order:
1. Call opendocs_redaction_script with target_text (the visible label of the element you are about to click/type into) or target_selector.
2. Run the returned function in the page with your browser evaluate tool. If it evaluates to {installed:false}, call opendocs_redaction_script again with install:true, run THAT, then continue.
3. Take a VIEWPORT screenshot (not full-page) and save it to a file your browser tool can write.
4. Call opendocs_step with file_path, instruction (imperative, what the reader does, e.g. "Click **Add to cart**"), action, page_url, and redaction_report exactly as returned - it carries the highlight target.
5. THEN perform the click/type/navigation. Never screenshot after acting; the screenshot must show the page BEFORE the action.
Reuse the session_id from the first step's result on every later step. A final result step (e.g. a confirmation page) can omit target_text/target_selector. After the LAST step, ALWAYS call opendocs_compile with session_id and a title, then give the user the URL - never stop before compiling. Never type real secrets into forms; redaction covers password fields for you.`;

const REDACT_MODE_VALUES = ['strict', 'basic', 'off'] as const;

const BOX_INPUT_SCHEMA = {
  type: 'object',
  description:
    'Highlight box in screenshot pixels. Optional: normally omit this and pass redaction_report ' +
    'instead, and the box is computed from its target for you.',
  properties: {
    x: { type: 'number', description: 'Left edge, in screenshot pixels.' },
    y: { type: 'number', description: 'Top edge, in screenshot pixels.' },
    w: { type: 'number', description: 'Width, in screenshot pixels.' },
    h: { type: 'number', description: 'Height, in screenshot pixels.' },
  },
  required: ['x', 'y', 'w', 'h'],
  additionalProperties: false,
} as const;

const TARGET_INPUT_SCHEMA = {
  type: 'object',
  description: 'The located target element, in CSS px, as returned by opendocs_redaction_script.',
  properties: {
    x: { type: 'number', description: 'Target left edge, viewport-relative CSS px.' },
    y: { type: 'number', description: 'Target top edge, viewport-relative CSS px.' },
    w: { type: 'number', description: 'Target width, CSS px.' },
    h: { type: 'number', description: 'Target height, CSS px.' },
    vw: { type: 'number', description: 'Viewport width at capture time, CSS px.' },
    vh: { type: 'number', description: 'Viewport height at capture time, CSS px.' },
    sx: { type: 'number', description: 'Page horizontal scroll offset at capture time, CSS px.' },
    sy: { type: 'number', description: 'Page vertical scroll offset at capture time, CSS px.' },
  },
  required: ['x', 'y', 'w', 'h', 'vw', 'vh', 'sx', 'sy'],
  additionalProperties: false,
} as const;

const REDACTION_REPORT_INPUT_SCHEMA = {
  type: 'object',
  description:
    'The object returned by running the opendocs_redaction_script function in the page. Pass it back ' +
    'unchanged.',
  properties: {
    count: { type: 'number', description: 'Number of elements the script redacted.' },
    script_version: { type: 'string', description: "The script's version, as returned." },
    boxes: {
      type: 'array',
      items: BOX_INPUT_SCHEMA,
      description: 'Redacted element boxes, screenshot pixels; carried through unchanged.',
    },
    target: { ...TARGET_INPUT_SCHEMA, description: 'The located target, if target_selector/target_text was set.' },
    target_error: { type: 'string', description: 'Set instead of target when the target was not found.' },
  },
  required: ['count', 'script_version'],
  additionalProperties: false,
} as const;

const SNAP_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    file_path: { type: 'string', description: 'Local path to the screenshot image file to upload.' },
    ttl: { type: 'string', enum: [...SNAP_TTL_VALUES], description: 'How long the uploaded URL stays valid.' },
    redact: {
      type: 'string',
      enum: [...REDACT_MODE_VALUES],
      description: 'Redaction mode for this call; defaults to the user/app setting, or "strict".',
    },
    redaction_report: REDACTION_REPORT_INPUT_SCHEMA,
  },
  required: ['file_path'],
  additionalProperties: false,
} as const;

const STEP_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    file_path: { type: 'string', description: 'Local path to the VIEWPORT screenshot for this step.' },
    instruction: {
      type: 'string',
      description: 'Imperative instruction describing what the reader does, e.g. "Click **Add to cart**".',
    },
    action: {
      type: 'string',
      enum: ['click', 'type', 'navigate', 'other'],
      description: 'The kind of action this step performs.',
    },
    selector: { type: 'string', description: 'Optional CSS selector of the acted-on element, for reference.' },
    box: BOX_INPUT_SCHEMA,
    page_url: { type: 'string', description: 'URL of the page shown in this step.' },
    session_id: {
      type: 'string',
      description: 'Omit on the first step; a new run is created. Reuse the returned session_id on every later step.',
    },
    title: { type: 'string', description: 'Optional run title; only used when this call creates the run.' },
    redact: {
      type: 'string',
      enum: [...REDACT_MODE_VALUES],
      description: 'Redaction mode for this call; defaults to the user/app setting, or "strict".',
    },
    redaction_report: REDACTION_REPORT_INPUT_SCHEMA,
  },
  required: ['file_path', 'instruction', 'action'],
  additionalProperties: false,
} as const;

const COMPILE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    session_id: { type: 'string', description: 'The session_id returned by the run\'s first opendocs_step call.' },
    title: { type: 'string', description: 'Title for the published doc.' },
  },
  required: ['session_id'],
  additionalProperties: false,
} as const;

const REDACTION_SCRIPT_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    target_selector: {
      type: 'string',
      description: 'CSS selector of the element you are about to act on. Use this or target_text, not both.',
    },
    target_text: {
      type: 'string',
      description:
        'Visible label of the element you are about to act on (e.g. its button text). Use this or ' +
        'target_selector, not both.',
    },
    install: {
      type: 'boolean',
      description:
        'Set true to get the full script (needed once per page load). Omit/false to get the short call, ' +
        'which returns {installed:false} if the full script has not been installed on this page yet.',
    },
    redact: {
      type: 'string',
      enum: [...REDACT_MODE_VALUES],
      description: 'Redaction mode to bake into the script; defaults to the user/app setting, or "strict".',
    },
  },
  required: [],
  additionalProperties: false,
} as const;

/**
 * Validate a `redact` field.
 *
 * Wrapped in `{ value }` because a valid result ("off") and an error message are
 * both plain strings, so a bare return value could not tell them apart.
 */
function parseRedact(value: unknown): { value: RedactMode | undefined } | string {
  if (value === undefined) return { value: undefined };
  if (typeof value !== 'string' || !(REDACT_MODE_VALUES as readonly string[]).includes(value)) {
    return 'redact must be one of strict, basic, off';
  }
  return { value: value as RedactMode };
}

/** A {@link RedactionReport} plus the target-finding fields the browser script may add. */
export interface ParsedRedactionReport extends RedactionReport {
  target?: TargetRect;
  target_error?: string;
}

/** Validate a `redaction_report.target` field, or return a one-line error. */
function parseTargetRect(value: unknown): TargetRect | undefined | string {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) return 'redaction_report.target must be an object';
  const t = value as Record<string, unknown>;
  for (const key of ['x', 'y', 'w', 'h', 'vw', 'vh', 'sx', 'sy'] as const) {
    if (typeof t[key] !== 'number' || !Number.isFinite(t[key])) {
      return `redaction_report.target.${key} must be a finite number`;
    }
  }
  return {
    x: t.x as number,
    y: t.y as number,
    w: t.w as number,
    h: t.h as number,
    vw: t.vw as number,
    vh: t.vh as number,
    sx: t.sx as number,
    sy: t.sy as number,
  };
}

/** Validate a `redaction_report` field, or return a one-line error. */
function parseRedactionReport(value: unknown): ParsedRedactionReport | undefined | string {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) return 'redaction_report must be an object';
  const r = value as Record<string, unknown>;
  if (typeof r.count !== 'number' || !Number.isFinite(r.count)) return 'redaction_report.count must be a number';
  if (typeof r.script_version !== 'string' || r.script_version.length === 0) {
    return 'redaction_report.script_version must be a string';
  }
  if (r.boxes !== undefined) {
    if (!Array.isArray(r.boxes)) return 'redaction_report.boxes must be an array';
    for (const box of r.boxes) {
      const parsedBox = parseBox(box);
      if (typeof parsedBox === 'string') return parsedBox;
    }
  }
  const target = parseTargetRect(r.target);
  if (typeof target === 'string') return target;
  if (r.target_error !== undefined && typeof r.target_error !== 'string') {
    return 'redaction_report.target_error must be a string';
  }
  return {
    count: r.count,
    script_version: r.script_version,
    boxes: r.boxes as Box[] | undefined,
    target,
    target_error: r.target_error as string | undefined,
  };
}

/** Strip the browser-side target-finding fields the API's redaction schema doesn't know about. */
function stripTarget(report: ParsedRedactionReport): RedactionReport {
  return { count: report.count, script_version: report.script_version, boxes: report.boxes };
}

interface SnapArgs {
  file_path: string;
  ttl?: SnapTtl;
  redact?: RedactMode;
  redaction_report?: ParsedRedactionReport;
}

/** Validate raw `opendocs_snap` arguments, or return a one-line error. */
function parseSnapArgs(args: unknown): SnapArgs | string {
  if (typeof args !== 'object' || args === null) return 'invalid arguments';
  const a = args as Record<string, unknown>;
  if (typeof a.file_path !== 'string' || a.file_path.length === 0) return 'file_path is required';
  if (a.ttl !== undefined && !(SNAP_TTL_VALUES as readonly string[]).includes(a.ttl as string)) {
    return 'ttl must be one of 15m, 1h, 24h';
  }
  const redact = parseRedact(a.redact);
  if (typeof redact === 'string') return redact;
  const redactionReport = parseRedactionReport(a.redaction_report);
  if (typeof redactionReport === 'string') return redactionReport;
  return {
    file_path: a.file_path,
    ttl: a.ttl as SnapTtl | undefined,
    redact: redact.value,
    redaction_report: redactionReport,
  };
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
  redact?: RedactMode;
  redaction_report?: ParsedRedactionReport;
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
  const redact = parseRedact(a.redact);
  if (typeof redact === 'string') return redact;
  const redactionReport = parseRedactionReport(a.redaction_report);
  if (typeof redactionReport === 'string') return redactionReport;
  return {
    file_path: a.file_path,
    instruction: a.instruction,
    action: a.action as StepAction,
    selector: a.selector as string | undefined,
    box,
    page_url: a.page_url as string | undefined,
    session_id: a.session_id as string | undefined,
    title: a.title as string | undefined,
    redact: redact.value,
    redaction_report: redactionReport,
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

/** Resolve the effective redaction mode for one call: call > user > app > strict. */
async function resolveEffectiveMode(
  callRedact: RedactMode | undefined,
  loadUser: () => Promise<RedactMode | undefined>,
  loadApp: (cwd: string) => Promise<{ mode?: RedactMode }>,
  cwd: () => string
): Promise<RedactMode> {
  const [user, app] = await Promise.all([loadUser(), loadApp(cwd())]);
  return resolveMode({ call: callRedact, user, app: app.mode });
}

async function handleSnap(
  args: unknown,
  fetchImpl: FetchLike,
  readKey: () => Promise<string | null>,
  loadUser: () => Promise<RedactMode | undefined>,
  loadApp: (cwd: string) => Promise<{ mode?: RedactMode }>,
  cwd: () => string
): Promise<ToolResult> {
  const parsed = parseSnapArgs(args);
  if (typeof parsed === 'string') return textResult(parsed, true);

  const key = await readKey();
  if (!key) return textResult(NOT_LOGGED_IN, true);

  const mode = await resolveEffectiveMode(parsed.redact, loadUser, loadApp, cwd);
  try {
    requireReport(mode, parsed.redaction_report);
  } catch (error) {
    return textResult(error instanceof Error ? error.message : String(error), true);
  }

  const uploaded = await uploadImage(parsed.file_path, key, 'snap', parsed.ttl, fetchImpl);
  if (!uploaded.ok) return textResult(mapApiError(uploaded), true);

  return textResult(`${uploaded.data.url} expires ${uploaded.data.expires_at}`);
}

async function handleStep(
  args: unknown,
  fetchImpl: FetchLike,
  readKey: () => Promise<string | null>,
  loadUser: () => Promise<RedactMode | undefined>,
  loadApp: (cwd: string) => Promise<{ mode?: RedactMode }>,
  cwd: () => string
): Promise<ToolResult> {
  const parsed = parseStepArgs(args);
  if (typeof parsed === 'string') return textResult(parsed, true);

  const key = await readKey();
  if (!key) return textResult(NOT_LOGGED_IN, true);

  const mode = await resolveEffectiveMode(parsed.redact, loadUser, loadApp, cwd);
  try {
    requireReport(mode, parsed.redaction_report);
  } catch (error) {
    return textResult(error instanceof Error ? error.message : String(error), true);
  }

  const maskedInstruction = maskStepText(parsed.instruction);

  let sessionId = parsed.session_id;
  if (!sessionId) {
    const maskedTitle = parsed.title !== undefined ? maskStepText(parsed.title).text : undefined;
    const run = await createRun(key, maskedTitle, fetchImpl);
    if (!run.ok) return textResult(mapApiError(run), true);
    sessionId = run.data.session_id;
  }

  const prepared = await prepareImage(parsed.file_path);
  if (!prepared.ok) return textResult(prepared.message, true);

  let box = parsed.box;
  if (box === undefined && parsed.redaction_report?.target !== undefined) {
    const metadata = await new Bun.Image(prepared.bytes).metadata();
    box = computeBoxFromTarget(parsed.redaction_report.target, metadata.width, metadata.height);
  }

  // A target or target_error was requested but no box ends up going out; tell
  // the caller why so it knows the highlight was skipped rather than lost.
  const hadTargetAttempt =
    parsed.redaction_report?.target !== undefined || parsed.redaction_report?.target_error !== undefined;
  const noHighlightReason =
    box === undefined && hadTargetAttempt
      ? parsed.redaction_report?.target_error ?? 'target outside the screenshot'
      : undefined;

  const uploaded = await uploadAsset(key, prepared.bytes, 'step', undefined, fetchImpl);
  if (!uploaded.ok) return textResult(mapApiError(uploaded), true);

  const body: AddStepBody = {
    asset_id: uploaded.data.id,
    action: parsed.action,
    instruction: maskedInstruction.text,
    selector: parsed.selector,
    box,
    page_url: parsed.page_url,
    redaction:
      mode === 'off'
        ? { mode }
        : { mode, report: parsed.redaction_report && stripTarget(parsed.redaction_report) },
  };

  const step = await addStep(key, sessionId, body, fetchImpl);
  if (!step.ok) return textResult(mapApiError(step), true);

  const maskedNote = maskedInstruction.count > 0 ? `, masked=${maskedInstruction.count}` : '';
  const highlightNote = noHighlightReason ? `, no highlight (${shortenReason(noHighlightReason)})` : '';
  return textResult(
    `step ${step.data.order} recorded, session_id=${sessionId}${maskedNote}${highlightNote}. ` +
      'Next: next step, or opendocs_compile when done.'
  );
}

/** Keep a no-highlight reason short enough that the step result stays within the 50-token cap. */
function shortenReason(reason: string): string {
  return reason.length > 60 ? `${reason.slice(0, 59)}…` : reason;
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

  // The title becomes the public doc title, so it is masked like step text.
  const title = parsed.title !== undefined ? maskStepText(parsed.title).text : undefined;
  const compiled = await compileRun(key, parsed.session_id, title, fetchImpl);
  if (!compiled.ok) return textResult(mapApiError(compiled), true);

  return textResult(compiled.data.url);
}

interface RedactionScriptArgs {
  target_selector?: string;
  target_text?: string;
  install?: boolean;
  redact?: RedactMode;
}

/** Validate raw `opendocs_redaction_script` arguments, or return a one-line error. */
function parseRedactionScriptArgs(args: unknown): RedactionScriptArgs | string {
  if (args === undefined || args === null) return {};
  if (typeof args !== 'object') return 'invalid arguments';
  const a = args as Record<string, unknown>;
  if (a.target_selector !== undefined && typeof a.target_selector !== 'string') {
    return 'target_selector must be a string';
  }
  if (a.target_text !== undefined && typeof a.target_text !== 'string') {
    return 'target_text must be a string';
  }
  if (a.install !== undefined && typeof a.install !== 'boolean') return 'install must be a boolean';
  const redact = parseRedact(a.redact);
  if (typeof redact === 'string') return redact;
  return {
    target_selector: a.target_selector as string | undefined,
    target_text: a.target_text as string | undefined,
    install: a.install as boolean | undefined,
    redact: redact.value,
  };
}

async function handleRedactionScript(
  args: unknown,
  loadUser: () => Promise<RedactMode | undefined>,
  loadApp: (cwd: string) => Promise<{ mode?: RedactMode; selectors?: string[]; allow?: string[] }>,
  cwd: () => string
): Promise<ToolResult> {
  const parsed = parseRedactionScriptArgs(args);
  if (typeof parsed === 'string') return textResult(parsed, true);

  const app = await loadApp(cwd());
  const mode = await resolveEffectiveMode(parsed.redact, loadUser, async () => app, cwd);

  const options: RunOptions = {
    mode,
    selectors: app.selectors,
    allow: app.allow,
    target_selector: parsed.target_selector,
    target_text: parsed.target_text,
  };

  const script = parsed.install ? buildInstallScript(options) : buildOneLineCall(options);
  return { content: [{ type: 'text', text: script }] };
}

/**
 * Build the MCP server with its tool handlers wired up.
 *
 * @param deps Injectable `fetch` and credential reader, for tests.
 */
export function createMcpServer(deps: McpDeps = {}): Server {
  const fetchImpl = deps.fetch ?? fetch;
  const readKey = deps.readKey ?? readCredentials;
  const loadUser = deps.loadUserMode ?? loadUserMode;
  const loadApp = deps.loadAppConfig ?? loadAppConfig;
  const cwd = deps.cwd ?? (() => process.cwd());

  const server = new Server(
    { name: 'opendocs', version: pkg.version },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'opendocs_redaction_script',
        description:
          'Get the redaction/target-finding function to run in the page before EACH step, via your ' +
          'browser evaluate tool. Pass target_text or target_selector for the element you are about ' +
          'to act on. Returns a short one-line call by default; if it evaluates to {installed:false}, ' +
          'call again with install:true and run that instead (once per page load), then re-run the ' +
          'short call. Run it, THEN screenshot, THEN opendocs_step - never after the action.',
        inputSchema: REDACTION_SCRIPT_INPUT_SCHEMA,
      },
      {
        name: 'opendocs_snap',
        description:
          'Upload a short-lived screenshot and get back its URL. Run opendocs_redaction_script first ' +
          'and pass its report unless redact is "off".',
        inputSchema: SNAP_INPUT_SCHEMA,
      },
      {
        name: 'opendocs_step',
        description:
          'Record one documentation step: uploads an image and adds it to a run. Run ' +
          'opendocs_redaction_script first and pass its report unless redact is "off". The highlight ' +
          'box is computed automatically from the report\'s target; only pass box yourself to override.',
        inputSchema: STEP_INPUT_SCHEMA,
      },
      {
        name: 'opendocs_compile',
        description: 'Compile a run into a published doc and get back its URL. Always call this last.',
        inputSchema: COMPILE_INPUT_SCHEMA,
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      switch (name) {
        case 'opendocs_redaction_script':
          return await handleRedactionScript(args, loadUser, loadApp, cwd);
        case 'opendocs_snap':
          return await handleSnap(args, fetchImpl, readKey, loadUser, loadApp, cwd);
        case 'opendocs_step':
          return await handleStep(args, fetchImpl, readKey, loadUser, loadApp, cwd);
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
