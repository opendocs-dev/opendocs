/**
 * Typed client for the OpenDocs API.
 *
 * Every call returns a discriminated result instead of throwing, so commands can
 * map a failure to one user-facing line without a try/catch around each call.
 */
import type {
  AddStepBody,
  AddStepResponse,
  AssetUploadResponse,
  CategoriesResponse,
  CompileRunResponse,
  CreateRunResponse,
  ErrorResponse,
  MeResponse,
} from '@opendocs/core/contract';
import type { SnapTtl } from '@opendocs/core/limits';
import pkg from '../package.json' with { type: 'json' };

const DEFAULT_API_URL = 'https://opendocs.tunnel.juniyadi.id/api/v1';

/** How a request failed, in the terms the CLI reports to the user. */
export type ApiFailureKind = 'unauthorized' | 'upgrade' | 'network' | 'error';

export type ApiResult<T> =
  | { ok: true; me: T }
  | { ok: false; kind: ApiFailureKind; message: string };

/** Discriminated result for the run/asset calls below: never throws. */
export type ApiCallResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: ApiFailureKind; message: string };

/** The minimal `fetch` shape this module needs, so tests can pass a stub. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: BodyInit }
) => Promise<Response>;

/** Asset kind, as sent in the `x-opendocs-kind` header. */
export type AssetKind = 'step' | 'snap';

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

/** Run `fetchImpl`, turning a thrown network error into a result instead of a throw. */
async function safeFetch(
  fetchImpl: FetchLike,
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: BodyInit }
): Promise<Response | { ok: false; kind: 'network'; message: string }> {
  try {
    return await fetchImpl(url, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, kind: 'network', message: `cannot reach ${apiBaseUrl()}: ${message}` };
  }
}

/** Map a completed response to a result: 401/403 → unauthorized, else API message or status text. */
async function handleApiResponse<T>(response: Response): Promise<ApiCallResult<T>> {
  if (response.ok) {
    try {
      return { ok: true, data: (await response.json()) as T };
    } catch {
      return { ok: false, kind: 'error', message: 'malformed response from the API' };
    }
  }

  if (response.status === 401 || response.status === 403) {
    const message = await errorMessage(response);
    return { ok: false, kind: 'unauthorized', message: message ?? 'unauthorized' };
  }

  const message = await errorMessage(response);
  return { ok: false, kind: 'error', message: message ?? response.statusText };
}

/** Sniff an image's content-type from its magic bytes; the API rejects anything else. */
function sniffImageContentType(bytes: Uint8Array): string {
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  return 'application/octet-stream';
}

/**
 * Upload an image asset: `POST /assets`.
 *
 * @param key API key.
 * @param bytes Image bytes; content-type is sniffed from the magic bytes.
 * @param kind `step` (attached to a run step) or `snap` (short-lived, has a TTL).
 * @param ttl TTL for a `snap` upload; ignored for `step`.
 * @param fetchImpl Injectable `fetch`.
 */
export async function uploadAsset(
  key: string,
  bytes: Uint8Array,
  kind: AssetKind,
  ttl?: SnapTtl,
  fetchImpl: FetchLike = fetch
): Promise<ApiCallResult<AssetUploadResponse>> {
  const headers: Record<string, string> = {
    'content-type': sniffImageContentType(bytes),
    'content-length': String(bytes.length),
    'x-opendocs-kind': kind,
    'x-api-key': key,
    'x-opendocs-cli-version': pkg.version,
  };
  if (kind === 'snap' && ttl) {
    headers['x-opendocs-ttl'] = ttl;
  }

  const response = await safeFetch(fetchImpl, `${apiBaseUrl()}/assets`, {
    method: 'POST',
    headers,
    body: bytes as BodyInit,
  });
  if (!(response instanceof Response)) return response;
  return handleApiResponse<AssetUploadResponse>(response);
}

/**
 * Start a new run: `POST /runs`.
 *
 * @param key API key.
 * @param title Optional run title.
 * @param fetchImpl Injectable `fetch`.
 */
export async function createRun(
  key: string,
  title?: string,
  fetchImpl: FetchLike = fetch
): Promise<ApiCallResult<CreateRunResponse>> {
  const response = await safeFetch(fetchImpl, `${apiBaseUrl()}/runs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'x-opendocs-cli-version': pkg.version,
    },
    body: JSON.stringify(title ? { title } : {}),
  });
  if (!(response instanceof Response)) return response;
  return handleApiResponse<CreateRunResponse>(response);
}

/**
 * Add a step to a run: `POST /runs/{id}/steps`.
 *
 * @param key API key.
 * @param sessionId The run's session id.
 * @param body The step payload.
 * @param fetchImpl Injectable `fetch`.
 */
export async function addStep(
  key: string,
  sessionId: string,
  body: AddStepBody,
  fetchImpl: FetchLike = fetch
): Promise<ApiCallResult<AddStepResponse>> {
  const response = await safeFetch(fetchImpl, `${apiBaseUrl()}/runs/${encodeURIComponent(sessionId)}/steps`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'x-opendocs-cli-version': pkg.version,
    },
    body: JSON.stringify(body),
  });
  if (!(response instanceof Response)) return response;
  return handleApiResponse<AddStepResponse>(response);
}

/**
 * Compile a run into a doc: `POST /runs/{id}/compile`.
 *
 * @param key API key.
 * @param sessionId The run's session id.
 * @param title Optional doc title.
 * @param fetchImpl Injectable `fetch`.
 * @param extra Optional category and summary fields.
 */
export async function compileRun(
  key: string,
  sessionId: string,
  title?: string,
  fetchImpl: FetchLike = fetch,
  extra?: { category?: string; summary?: string }
): Promise<ApiCallResult<CompileRunResponse>> {
  const response = await safeFetch(fetchImpl, `${apiBaseUrl()}/runs/${encodeURIComponent(sessionId)}/compile`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'x-opendocs-cli-version': pkg.version,
    },
    body: JSON.stringify({
      ...(title ? { title } : {}),
      ...(extra?.category ? { category: extra.category } : {}),
      ...(extra?.summary ? { summary: extra.summary } : {}),
    }),
  });
  if (!(response instanceof Response)) return response;
  return handleApiResponse<CompileRunResponse>(response);
}

/**
 * List workspace categories: `GET /categories`.
 *
 * @param key API key.
 * @param fetchImpl Injectable `fetch`.
 */
export async function getCategories(
  key: string,
  fetchImpl: FetchLike = fetch
): Promise<ApiCallResult<CategoriesResponse>> {
  const response = await safeFetch(fetchImpl, `${apiBaseUrl()}/categories`, {
    method: 'GET',
    headers: {
      'x-api-key': key,
      'x-opendocs-cli-version': pkg.version,
    },
  });
  if (!(response instanceof Response)) return response;
  return handleApiResponse<CategoriesResponse>(response);
}
