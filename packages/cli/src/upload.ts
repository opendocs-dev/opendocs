/**
 * Turn a local file path into upload-ready WebP bytes, then hand them to the API.
 *
 * All local validation (missing file, bad format, too many pixels, too big after
 * compression) happens in {@link prepareImage} and never reaches the network.
 */
import os from 'node:os';
import { MAX_BYTES } from '@opendocs/core/limits';
import type { AssetKind, ApiCallResult, FetchLike } from './api';
import type { AssetUploadResponse } from '@opendocs/core/contract';
import { uploadAsset } from './api';
import { toWebp } from './compress';
import type { SnapTtl } from '@opendocs/core/limits';

export type PrepareImageResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; message: string };

/** Collaborators for {@link prepareImage}, injected so tests avoid real files/codecs. */
export interface PrepareImageDeps {
  readFile?: (filePath: string) => Promise<Uint8Array>;
  toWebp?: (input: Uint8Array, quality?: number) => Promise<Uint8Array>;
  maxBytes?: number;
}

const ONE_MB = 1024 * 1024;

/** True when `bytes` starts with a RIFF....WEBP container header. */
function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

/** Agents often pass `~/…`; a shell would expand it, Bun.file does not. */
export function expandHome(filePath: string): string {
  return filePath === '~' || filePath.startsWith('~/') ? os.homedir() + filePath.slice(1) : filePath;
}

async function defaultReadFile(filePath: string): Promise<Uint8Array> {
  const file = Bun.file(expandHome(filePath));
  if (!(await file.exists())) {
    throw new Error('ENOENT');
  }
  return await file.bytes();
}

/**
 * Read a local file and produce upload-ready WebP bytes.
 *
 * WebP input already at or under 1 MB is passed through unchanged; anything
 * else is re-encoded to WebP at quality 80. Never calls the API.
 *
 * @param filePath Path to the local image file.
 * @param deps Injectable file reader / encoder / size limit.
 */
export async function prepareImage(
  filePath: string,
  deps: PrepareImageDeps = {}
): Promise<PrepareImageResult> {
  const readFile = deps.readFile ?? defaultReadFile;
  const encode = deps.toWebp ?? toWebp;
  const maxBytes = deps.maxBytes ?? MAX_BYTES;

  let raw: Uint8Array;
  try {
    raw = await readFile(filePath);
  } catch {
    const basename = filePath.split(/[/\\]/).pop() ?? filePath;
    return { ok: false, message: `file not found: ${basename}` };
  }

  let bytes: Uint8Array;
  if (isWebp(raw) && raw.length <= ONE_MB) {
    bytes = raw;
  } else {
    try {
      bytes = await encode(raw, 80);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'ERR_IMAGE_TOO_MANY_PIXELS') {
        return { ok: false, message: 'image over 50 megapixels' };
      }
      return { ok: false, message: 'unsupported image format (PNG, JPEG, WebP)' };
    }
  }

  if (bytes.length > maxBytes) {
    return { ok: false, message: 'image over 10 MB after compression' };
  }

  return { ok: true, bytes };
}

/**
 * Prepare a local image and upload it as an asset.
 *
 * A local preparation failure (missing file, bad format, too big) is surfaced
 * with the same shape as an API failure, but never touches the network.
 *
 * @param filePath Path to the local image file.
 * @param key API key.
 * @param kind `step` or `snap`.
 * @param ttl TTL for a `snap` upload.
 * @param fetchImpl Injectable `fetch`.
 * @param deps Injectable {@link prepareImage} collaborators.
 */
export async function uploadImage(
  filePath: string,
  key: string,
  kind: AssetKind,
  ttl?: SnapTtl,
  fetchImpl: FetchLike = fetch,
  deps: PrepareImageDeps = {}
): Promise<ApiCallResult<AssetUploadResponse>> {
  const prepared = await prepareImage(filePath, deps);
  if (!prepared.ok) {
    return { ok: false, kind: 'error', message: prepared.message };
  }
  return await uploadAsset(key, prepared.bytes, kind, ttl, fetchImpl);
}
