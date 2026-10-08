import { getEnv } from './env';

/**
 * Public URL of a stored image. With `ASSET_BASE_URL` set (a CDN or public bucket URL) the
 * object key is addressed directly; otherwise the image goes through the api route
 * `/api/i/:id`, which is reachable behind the same `PUBLIC_URL` as the rest of `/api`.
 */
export const assetUrl = (asset: { publicId: string; providerFileId: string }): string => {
  const env = getEnv();
  if (env.assetBaseUrl) return `${env.assetBaseUrl}/${env.s3.prefix}${asset.providerFileId}`;
  return `${env.publicUrl}/api/i/${asset.publicId}`;
};
