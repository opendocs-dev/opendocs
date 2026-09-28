/**
 * Typed client for the OpenDocs API.
 *
 * Every call returns a discriminated result instead of throwing, so commands can
 * map a failure to one user-facing line without a try/catch around each call.
 */
import type { ErrorResponse, MeResponse } from '@opendocs/core/contract';
import pkg from '../package.json' with { type: 'json' };

const DEFAULT_API_URL = 'https://opendocs.juniyadi.id/api/v1';

/** How a request failed, in the terms the CLI reports to the user. */
export type ApiFailureKind = 'unauthorized' | 'upgrade' | 'network' | 'error';

export type ApiResult<T> =
  | { ok: true; me: T }
  | { ok: false; kind: ApiFailureKind; message: string };

/** The minimal `fetch` shape this module needs, so tests can pass a stub. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> }
) => Promise<Response>;

/**
 * The API base URL, without a trailing slash.
 *
 * @param env Environment to read OPENDOCS_API_URL from.
 */
export function apiBaseUrl(
  env: Record<string, string | undefined> = process.env
): string {
  const base = env.OPENDOCS_API_URL?.trim();
  return (base && base.length > 0 ? base : DEFAULT_API_URL).replace(/\/+$/, '');
}

/** Pull `error.message` out of a response body, when the body has that shape. */
async function errorMessage(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as Partial<ErrorResponse>;
    const message = body?.error?.message;
    return typeof message === 'string' && message.length > 0 ? message : null;
  } catch {
    return null;
  }
}

/**
 * Fetch the workspace behind an API key: `GET /me`.
 *
 * Used by `login` to validate a key before it is written to disk.
 *
 * @param key The API key to authenticate with.
 * @param fetchImpl Injectable `fetch`.
 */
export async function getMe(
  key: string,
  fetchImpl: FetchLike = fetch
): Promise<ApiResult<MeResponse>> {
  let response: Response;
  try {
    response = await fetchImpl(`${apiBaseUrl()}/me`, {
      method: 'GET',
      headers: {
        'x-api-key': key,
        'x-opendocs-cli-version': pkg.version,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      kind: 'network',
      message: `cannot reach ${apiBaseUrl()}: ${message}`,
    };
  }

  if (response.ok) {
    try {
      return { ok: true, me: (await response.json()) as MeResponse };
    } catch {
      return { ok: false, kind: 'error', message: 'malformed response from the API' };
    }
  }

  if (response.status === 401 || response.status === 403) {
    const message = await errorMessage(response);
    return { ok: false, kind: 'unauthorized', message: message ?? 'unauthorized' };
  }

  if (response.status === 426) {
    const message = await errorMessage(response);
    const hint = message ?? 'this CLI version is no longer supported';
    return {
      ok: false,
      kind: 'upgrade',
      message: `${hint} - upgrade the CLI (current ${pkg.version})`,
    };
  }

  const message = await errorMessage(response);
  return {
    ok: false,
    kind: 'error',
    message: message ?? `request failed with status ${response.status}`,
  };
}
