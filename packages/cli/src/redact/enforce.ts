/**
 * Redaction mode resolution and enforcement.
 *
 * Screenshots are redacted in the browser before capture, on by default. A
 * mode of "off" is the explicit escape hatch; strict/basic both require a
 * report proving the script ran, checked before any upload happens.
 */
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RedactionReport } from '@opendocs/core/contract';

export const REDACT_MODES = ['strict', 'basic', 'off'] as const;
export type RedactMode = (typeof REDACT_MODES)[number];

const APP_DIR = 'opendocs';
const USER_CONFIG_FILE = 'config.json';

export interface AppRedactConfig {
  mode?: RedactMode;
  selectors?: string[];
  allow?: string[];
}

/** Validate a raw mode string; throws with a one-line message on failure. */
function assertMode(mode: string): RedactMode {
  if (!(REDACT_MODES as readonly string[]).includes(mode)) {
    throw new Error(`unknown redact mode "${mode}": use strict, basic or off`);
  }
  return mode as RedactMode;
}

/**
 * Resolve the effective redaction mode: call > user > app > "strict".
 *
 * @param sources The mode requested per-call, saved for the user, or set in
 *   the project's `.opendocs/redact.json`, in precedence order.
 */
export function resolveMode(sources: {
  call?: string;
  user?: string;
  app?: string;
}): RedactMode {
  const raw = sources.call ?? sources.user ?? sources.app ?? 'strict';
  return assertMode(raw);
}

/** True when `report` has the shape a valid redaction report must have. */
function isValidReport(report: unknown): report is RedactionReport {
  if (typeof report !== 'object' || report === null) return false;
  const r = report as Record<string, unknown>;
  return typeof r.count === 'number' && typeof r.script_version === 'string';
}

/**
 * Require a valid report when `mode` is strict/basic; throws a one-line error
 * naming `redact: "off"` as the escape hatch otherwise.
 *
 * @param mode The resolved redaction mode.
 * @param report The report the caller supplied, if any.
 */
export function requireReport(mode: RedactMode, report: unknown): void {
  if (mode === 'off') return;
  if (isValidReport(report)) return;
  throw new Error(
    `redact: "${mode}" requires a redaction_report from opendocs_redaction_script; pass redact: "off" to skip redaction`
  );
}

/**
 * Load the project-level redaction config from `<cwd>/.opendocs/redact.json`.
 *
 * Missing file: `{}`. Malformed JSON: `{}` plus a one-line stderr warning.
 *
 * @param cwd Project root to look under.
 * @param warn Injectable stderr writer, for tests.
 */
export async function loadAppConfig(
  cwd: string,
  warn: (line: string) => void = (line) => process.stderr.write(line)
): Promise<AppRedactConfig> {
  const file = path.join(cwd, '.opendocs', 'redact.json');
  let text: string;
  try {
    text = await Bun.file(file).text();
  } catch {
    return {};
  }
  try {
    return JSON.parse(text) as AppRedactConfig;
  } catch {
    warn('warning: .opendocs/redact.json is malformed JSON, falling back to strict\n');
    return {};
  }
}

/** Directory holding the user-level config file, mirroring {@link import('../config').credentialsPath}. */
function userConfigPath(
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env,
  home: string = os.homedir()
): string {
  if (platform === 'win32') {
    const appData = env.APPDATA ?? path.win32.join(home, 'AppData', 'Roaming');
    return path.win32.join(appData, APP_DIR, USER_CONFIG_FILE);
  }
  const configHome = env.XDG_CONFIG_HOME ?? path.join(home, '.config');
  return path.join(configHome, APP_DIR, USER_CONFIG_FILE);
}

/**
 * Read the user's saved redaction mode from `<config dir>/opendocs/config.json`.
 *
 * @param file Source path; defaults to the platform config location.
 */
export async function loadUserMode(file: string = userConfigPath()): Promise<RedactMode | undefined> {
  try {
    const text = await Bun.file(file).text();
    const parsed = JSON.parse(text) as { redact?: string };
    if (typeof parsed.redact !== 'string') return undefined;
    return (REDACT_MODES as readonly string[]).includes(parsed.redact)
      ? (parsed.redact as RedactMode)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Save the user's redaction mode to `<config dir>/opendocs/config.json`, atomically.
 *
 * @param mode The mode to save.
 * @param file Target path; defaults to the platform config location.
 */
export async function saveUserMode(mode: RedactMode, file: string = userConfigPath()): Promise<void> {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const temp = path.join(dir, `.${USER_CONFIG_FILE}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(temp, `${JSON.stringify({ redact: mode })}\n`, { mode: 0o600 });
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
