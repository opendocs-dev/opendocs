/**
 * `opendocs login --key <key>`
 *
 * The key is validated against `GET /me` before anything is written, so a bad key
 * can never replace a working one on disk.
 */
import type { ApiResult, FetchLike } from '../api';
import { getMe } from '../api';
import { credentialsPath, saveCredentials } from '../config';
import type { MeResponse } from '@opendocs/core/contract';

/** Writers and collaborators, injected so tests stay off the real filesystem. */
export interface LoginDeps {
  getMe?: (key: string, fetchImpl?: FetchLike) => Promise<ApiResult<MeResponse>>;
  fetchImpl?: FetchLike;
  credentialsFile?: string;
  saveCredentials?: (key: string, file: string) => Promise<void>;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

const USAGE = 'usage: opendocs login --key <key>';

/** Parse `--key <key>` out of argv. */
function parseKey(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--key') {
      const value = argv[i + 1];
      return value && !value.startsWith('-') ? value : null;
    }
    const inline = argv[i]?.startsWith('--key=') ? argv[i]!.slice(6) : null;
    if (inline) return inline;
  }
  return null;
}

/**
 * Run the login command.
 *
 * @returns The process exit code.
 */
export async function login(argv: string[], deps: LoginDeps = {}): Promise<number> {
  const out = deps.stdout ?? ((line) => process.stdout.write(line));
  const err = deps.stderr ?? ((line) => process.stderr.write(line));
  const me = deps.getMe ?? getMe;
  const save = deps.saveCredentials ?? saveCredentials;
  const file = deps.credentialsFile ?? credentialsPath();

  const key = parseKey(argv);
  if (!key) {
    err(`error: --key is required\n${USAGE}\n`);
    return 1;
  }

  const result = await me(key, deps.fetchImpl);

  if (!result.ok) {
    if (result.kind === 'unauthorized') {
      err('error: that API key is invalid or has been revoked\n');
    } else {
      err(`error: ${result.message}\n`);
    }
    return 1;
  }

  try {
    await save(key, file);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    err(`error: cannot save credentials: ${message}\n`);
    return 1;
  }

  out(`Logged in to ${result.me.workspace.name}\n`);
  return 0;
}
