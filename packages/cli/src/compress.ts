/**
 * Image compression for the OpenDocs CLI.
 * Built on Bun.Image; every decode is bounded by MAX_PIXELS from @opendocs/core
 * so a decompression bomb is rejected before the pixel buffer is allocated.
 */
import { MAX_PIXELS } from '@opendocs/core/limits';

/**
 * Encode an image to WebP.
 *
 * @param input Raw image bytes (format is sniffed by Bun.Image, not by extension).
 * @param quality WebP quality, 1-100. Defaults to Bun.Image's own default (80).
 * @returns The WebP-encoded bytes.
 * @throws If the input is not a decodable image, or exceeds MAX_PIXELS.
 */
export async function toWebp(
  input: Uint8Array | ArrayBuffer,
  quality?: number
): Promise<Uint8Array> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return await new Bun.Image(bytes, { maxPixels: MAX_PIXELS }).webp({ quality }).bytes();
}
