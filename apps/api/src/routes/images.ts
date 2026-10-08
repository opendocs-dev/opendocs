import { Elysia } from 'elysia';
import { getPrisma } from '../db';
import { ApiError } from '../errors';
import { getStorage, resolveStorageProvider, type Storage } from '../storage/provider';

const MAX_AGE = 3600;

/**
 * `/i/{id}.svg` must serve the asset {id} with its stored mime: the extension is
 * cosmetic (clients append one for nicer links) and is never trusted.
 */
const publicIdOf = (param: string) => param.split('.')[0] ?? '';

/**
 * Cached for an hour at most, and never past expiry, so a CDN cannot keep serving an
 * asset the TTL has already retired.
 */
const maxAge = (expiresAt: Date | null, now: number) => {
  if (!expiresAt) return MAX_AGE;
  return Math.max(0, Math.min(MAX_AGE, Math.floor((expiresAt.getTime() - now) / 1000)));
};

/**
 * Public, unauthenticated image delivery at the root: the publicId is the only
 * credential, which is why nothing here reveals the storage provider (no redirect to
 * the backing object, no provider URL in headers or body).
 */
export const imagesRoute = (storage?: Storage) =>
  new Elysia().get('/i/:id', async ({ params, set }) => {
    // Set first so every failure path below is uncacheable, whichever way the error
    // plugin turns the ApiError into a response.
    set.headers['cache-control'] = 'no-store';

    const asset = await getPrisma().asset.findUnique({
      where: { publicId: publicIdOf(params.id) },
    });
    if (!asset) throw new ApiError(404, 'not_found', 'Image not found');

    // Checked on read, not by a background job: an expired row may still exist.
    const now = Date.now();
    if (asset.deletedAt || (asset.expiresAt && asset.expiresAt.getTime() <= now)) {
      throw new ApiError(410, 'gone', 'Image has expired');
    }

    let bytes: Uint8Array;
    try {
      // A test-injected storage override always wins (it is simulating a specific
      // provider, e.g. a failing read); otherwise the asset's own recorded provider
      // decides, never the deployment-wide STORAGE_PROVIDER.
      const provider = storage ? storage.provider : resolveStorageProvider(asset.provider);
      bytes = await provider.read(asset.providerAccount, asset.providerFileId);
    } catch {
      throw new ApiError(500, 'internal_error', 'Image could not be read');
    }

    // The success path owns its own cache-control; drop the no-store guard so it cannot
    // be merged back onto this response.
    delete set.headers['cache-control'];

    return new Response(new Uint8Array(bytes), {
      headers: {
        // The stored mime, sniffed at upload time; nosniff and the sandbox CSP keep a
        // mislabelled payload from being executed in a browser.
        'content-type': asset.mime,
        'x-content-type-options': 'nosniff',
        'content-security-policy': 'sandbox',
        'cache-control': `public, immutable, max-age=${maxAge(asset.expiresAt, now)}`,
      },
    });
  });
