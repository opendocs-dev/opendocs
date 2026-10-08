import { AssetUploadResponseSchema, MAX_PIXELS, SNAP_TTL, type SnapTtl } from '@opendocs/core';
import { Elysia } from 'elysia';
import { assetUrl } from '../asset-url';
import { resolveOrganizationId } from '../auth-context';
import { getPrisma } from '../db';
import { getLimits } from '../env';
import { ApiError } from '../errors';
import { newPublicId } from '../ids';
import { getStorage, type Storage } from '../storage/provider';
import { acquireSlot, checkStorageQuota, maybeSendQuotaAlert, releaseSlot } from '../quota';

const KINDS = ['step', 'snap', 'brand'] as const;
type Kind = (typeof KINDS)[number];

const invalid = (message: string) => new ApiError(422, 'validation_failed', message);
const tooLarge = () =>
  new ApiError(413, 'payload_too_large', `Upload exceeds the ${getLimits().maxUploadBytes} byte limit`);
const unsupported = () =>
  new ApiError(415, 'unsupported_media_type', 'Only PNG, JPEG and WebP images are accepted');

/** Reads the declared kind and (snap-only) TTL. Nothing is stored before these pass. */
const readUploadHeaders = (request: Request): { kind: Kind; ttl: SnapTtl } => {
  const kind = request.headers.get('x-opendocs-kind');
  if (kind !== 'step' && kind !== 'snap' && kind !== 'brand') {
    throw invalid('x-opendocs-kind must be "step", "snap" or "brand"');
  }

  const header = request.headers.get('x-opendocs-ttl');
  if (header === null) return { kind, ttl: SNAP_TTL.default };

  if (kind !== 'snap') throw invalid('x-opendocs-ttl only applies to snap uploads');
  if (!(SNAP_TTL.values as readonly string[]).includes(header)) {
    throw invalid(`x-opendocs-ttl must be one of ${SNAP_TTL.values.join(', ')}`);
  }

  return { kind, ttl: header as SnapTtl };
};

const startsWith = (bytes: Uint8Array, prefix: readonly number[]) =>
  bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
const RIFF = [0x52, 0x49, 0x46, 0x46] as const;
const WEBP = [0x57, 0x45, 0x42, 0x50] as const;

/**
 * The stored mime comes from the bytes, never from the content-type header, so a
 * mislabelled or hostile payload cannot smuggle a type past this point.
 */
const sniffMime = (bytes: Uint8Array): string => {
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'image/jpeg';
  if (startsWith(bytes, RIFF) && startsWith(bytes.subarray(8), WEBP)) return 'image/webp';
  throw unsupported();
};

/**
 * Streams the body while counting bytes, so an oversized upload is abandoned instead
 * of buffered. Exactly MAX_UPLOAD_BYTES is accepted; one byte more aborts with 413. A client
 * that disconnects mid-stream gets 400 validation_failed and leaves nothing behind.
 */
const readBody = async (request: Request): Promise<Uint8Array> => {
  const { maxUploadBytes } = getLimits();
  // A duplicated header arrives joined ("5000, 20000000"): anything but one integer is rejected.
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) throw invalid('content-length must be a single integer');
    if (Number(declared) > maxUploadBytes) throw tooLarge();
  }

  const body = request.body;
  if (!body) throw invalid('A request body is required');

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > maxUploadBytes) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // Documented choice: a client that disappears mid-upload gets 400 validation_failed
    // rather than a 500, because nothing on the server went wrong.
    throw new ApiError(
      400,
      'validation_failed',
      'Request body ended before the upload completed',
    );
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
};

/** Decodes only the header; Bun enforces the pixel ceiling before allocating pixels. */
const readDimensions = async (bytes: Uint8Array): Promise<{ width: number; height: number }> => {
  try {
    const metadata = await new Bun.Image(bytes, { maxPixels: MAX_PIXELS }).metadata();
    return { width: metadata.width, height: metadata.height };
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_IMAGE_TOO_MANY_PIXELS') {
      throw new ApiError(
        422,
        'image_too_many_pixels',
        `Image exceeds the ${MAX_PIXELS} pixel limit`,
      );
    }
    // ERR_IMAGE_UNKNOWN_FORMAT and every other decode failure: the bytes are not a
    // usable image even though the magic bytes looked right.
    throw unsupported();
  }
};

/** A step image is a draft until its run is compiled, expiring after DRAFT_IMAGE_DAYS days;
 * compiling makes it permanent. Snaps follow the requested TTL. Brand images (site/guide
 * SEO) never expire. */
const expiryFor = (kind: Kind, ttl: SnapTtl, now: Date): Date | null => {
  if (kind === 'step') return new Date(now.getTime() + getLimits().draftImageDays * 86_400_000);
  if (kind === 'brand') return null;
  return new Date(now.getTime() + SNAP_TTL.seconds[ttl] * 1000);
};

export const assetsRoute = (storage?: Storage) =>
  new Elysia().post(
    '/api/v1/assets',
    async ({ request, status }) => {
      const organizationId = await resolveOrganizationId(request);
      const { kind, ttl } = readUploadHeaders(request);

      const now = new Date();
      acquireSlot(organizationId);
      try {
        const bytes = await readBody(request);
        if (kind === 'step') {
          try {
            await checkStorageQuota({ organizationId, incomingBytes: bytes.byteLength, now });
          } catch (error) {
            if (error instanceof ApiError && error.errorCode === 'storage_quota_exceeded') maybeSendQuotaAlert({ now });
            throw error;
          }
        }
        const mime = sniffMime(bytes);
        const { width, height } = await readDimensions(bytes);

        const hasher = new Bun.CryptoHasher('sha256');
        hasher.update(bytes);
        const sha256 = hasher.digest('hex');

        const store = storage ?? getStorage();
        const publicId = newPublicId();

        let fileId: string;
        try {
          ({ fileId } = await store.upload(bytes, mime));
        } catch {
          throw new ApiError(502, 'upload_failed', 'Storage rejected the upload');
        }

        const expiresAt = expiryFor(kind, ttl, new Date());

        try {
          await getPrisma().asset.create({
            data: {
              publicId,
              organizationId,
              kind,
              providerFileId: fileId,
              mime,
              bytes: bytes.byteLength,
              width,
              height,
              sha256,
              expiresAt,
            },
          });
        } catch (error) {
          // The row never landed, so the stored object would be an orphan.
          await store.delete(fileId).catch(() => {});
          throw error;
        }

        return status(201, {
          id: publicId,
          url: assetUrl({ publicId, providerFileId: fileId }),
          expires_at: expiresAt?.toISOString() ?? null,
        });
      } finally {
        releaseSlot(organizationId);
      }
    },
    {
      // Headers are checked by hand (see readUploadHeaders) rather than with
      // AssetUploadHeadersSchema: schema validation runs before the handler and would
      // answer 422 to an unauthenticated caller that also sent a bad header, but the
      // contract wants 401 to win. `parse: 'none'` keeps request.body streamable.
      parse: 'none',
      response: { 201: AssetUploadResponseSchema },
    },
  );
