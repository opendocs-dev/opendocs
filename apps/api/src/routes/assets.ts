import {
  AssetUploadResponseSchema,
  DRAFT_IMAGE_DAYS,
  MAX_BYTES,
  MAX_PIXELS,
  SNAP_TTL,
  type SnapTtl,
} from '@opendocs/core';
import { Elysia } from 'elysia';
import { resolveOrganizationId } from '../auth-context';
import { getPrisma } from '../db';
import { ApiError } from '../errors';
import { newPublicId } from '../ids';
import { getPlan } from '../plan';
import { resolveUploadDestination } from '../storage/connections';
import { getStorage, pickAccount, type Storage } from '../storage/provider';
import {
  acquireSlot,
  checkQuota,
  checkStorageQuota,
  maybeSendBreakerAlert,
  releaseSlot,
  startOfUtcDay,
} from '../quota';

const KINDS = ['step', 'snap', 'brand'] as const;
type Kind = (typeof KINDS)[number];

const invalid = (message: string) => new ApiError(422, 'validation_failed', message);
const tooLarge = () =>
  new ApiError(413, 'payload_too_large', `Upload exceeds the ${MAX_BYTES} byte limit`);
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
 * of buffered. Exactly MAX_BYTES is accepted; one byte more aborts with 413. A client
 * that disconnects mid-stream gets 400 validation_failed and leaves nothing behind.
 */
const readBody = async (request: Request): Promise<Uint8Array> => {
  // A duplicated header arrives joined ("5000, 20000000"): anything but one integer is rejected.
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) throw invalid('content-length must be a single integer');
    if (Number(declared) > MAX_BYTES) throw tooLarge();
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
      if (total > MAX_BYTES) {
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
 * compiling makes it permanent. Snaps follow the requested TTL regardless of plan. Brand
 * images (site/guide SEO) never expire. */
const expiryFor = (kind: Kind, ttl: SnapTtl, now: Date): Date | null => {
  if (kind === 'step') return new Date(now.getTime() + DRAFT_IMAGE_DAYS * 86_400_000);
  if (kind === 'brand') return null;
  return new Date(now.getTime() + SNAP_TTL.seconds[ttl] * 1000);
};

/**
 * Which provider and account an upload should use. A test-injected `storage`
 * override always wins (existing seam, unchanged). Otherwise: Free always uses
 * OpenDocs storage; Pro/Enterprise with an active, connected `StorageConnection`
 * use it; Pro/Enterprise with nothing active also use OpenDocs storage. An active
 * connection that is not usable throws rather than falling back silently — the
 * Contract rules that out for a workspace that has chosen its own storage.
 */
const resolveUploadProvider = async (
  organizationId: string,
  storage: Storage | undefined,
  buildProvider?: (connection: Parameters<typeof resolveUploadDestination>[1][number]) => Storage['provider'],
): Promise<{ provider: Storage['provider']; account: string }> => {
  if (storage) {
    return { provider: storage.provider, account: pickAccount(storage.accounts, Date.now()) };
  }
  const plan = await getPlan(organizationId);
  if (plan !== 'free') {
    const prisma = getPrisma();
    const [site, connections] = await Promise.all([
      prisma.workspaceSite.findUnique({ where: { organizationId }, select: { storageKind: true } }),
      prisma.storageConnection.findMany({ where: { organizationId } }),
    ]);
    const destination = resolveUploadDestination(site?.storageKind ?? null, connections, buildProvider);
    if (destination) return destination;
  }
  const { provider, accounts } = getStorage();
  return { provider, account: pickAccount(accounts, Date.now()) };
};

export const assetsRoute = (
  storage?: Storage,
  buildProvider?: (connection: Parameters<typeof resolveUploadDestination>[1][number]) => Storage['provider'],
) =>
  new Elysia().post(
    '/api/v1/assets',
    async ({ request, status }) => {
      const organizationId = await resolveOrganizationId(request);
      const { kind, ttl } = readUploadHeaders(request);

      const quotaNow = new Date();
      await checkQuota({
        organizationId,
        contentLengthHeader: request.headers.get('content-length'),
        now: quotaNow,
      });

      acquireSlot(organizationId);
      try {
        const bytes = await readBody(request);
        if (kind === 'step') {
          await checkStorageQuota({
            organizationId,
            incomingBytes: bytes.byteLength,
            now: quotaNow,
          });
        }
        const mime = sniffMime(bytes);
        const { width, height } = await readDimensions(bytes);

        const hasher = new Bun.CryptoHasher('sha256');
        hasher.update(bytes);
        const sha256 = hasher.digest('hex');

        const { provider, account } = await resolveUploadProvider(organizationId, storage, buildProvider);
        const publicId = newPublicId();

        let fileId: string;
        try {
          ({ fileId } = await provider.upload(account, publicId, bytes, mime));
        } catch {
          throw new ApiError(502, 'upload_failed', 'Storage provider rejected the upload');
        }

        const now = new Date();
        const expiresAt = expiryFor(kind, ttl, now);
        const prisma = getPrisma();

        try {
          await prisma.$transaction([
            prisma.asset.create({
              data: {
                publicId,
                organizationId,
                kind,
                provider: provider.name,
                providerAccount: account,
                providerFileId: fileId,
                mime,
                bytes: bytes.byteLength,
                width,
                height,
                sha256,
                expiresAt,
              },
            }),
            prisma.usageDaily.upsert({
              where: { organizationId_day: { organizationId, day: startOfUtcDay(now) } },
              create: {
                organizationId,
                day: startOfUtcDay(now),
                files: 1,
                bytes: BigInt(bytes.byteLength),
              },
              update: { files: { increment: 1 }, bytes: { increment: BigInt(bytes.byteLength) } },
            }),
          ]);
        } catch (error) {
          // The row never landed, so the stored object would be an orphan.
          await provider.delete(account, fileId).catch(() => {});
          throw error;
        }

        // Fire-and-forget: never delays or fails the response that just succeeded.
        void maybeSendBreakerAlert({ now });

        return status(201, {
          id: publicId,
          url: `${process.env.ASSET_BASE_URL}/i/${publicId}`,
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
