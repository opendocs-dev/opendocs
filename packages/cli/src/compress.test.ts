import { describe, expect, it } from 'bun:test';
import { MAX_PIXELS } from '@opendocs/core/limits';
import { toWebp } from './compress';
import { prepareImage } from './upload';

// URL (not .pathname) so the fixture resolves on Windows runners too.
const FIXTURE = new URL('../test/fixtures/sample.png', import.meta.url);

/** Compute a PNG chunk (length + type + data + CRC32), big-endian. */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);

  const out = new Uint8Array(4 + body.length + 4);
  new DataView(out.buffer).setUint32(0, data.length, false);
  out.set(body, 4);
  new DataView(out.buffer).setUint32(4 + body.length, Bun.hash.crc32(body) >>> 0, false);
  return out;
}

/**
 * Build a syntactically valid PNG whose IHDR claims `width x height`, without
 * allocating real pixel data - `maxPixels` is checked against the header
 * before any pixel buffer is allocated, so this is enough to exercise the
 * over-limit path cheaply.
 */
function fakePngHeader(width: number, height: number): Uint8Array {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = new Uint8Array(13);
  const view = new DataView(ihdrData.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: RGB

  const ihdr = pngChunk('IHDR', ihdrData);
  const iend = pngChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(signature.length + ihdr.length + iend.length);
  out.set(signature, 0);
  out.set(ihdr, signature.length);
  out.set(iend, signature.length + ihdr.length);
  return out;
}

describe('toWebp', () => {
  it('encodes PNG fixture to WebP under maxPixels', async () => {
    const input = await Bun.file(FIXTURE).bytes();
    const output = await toWebp(input);

    const header = new TextDecoder().decode(output.subarray(0, 12));
    expect(header.startsWith('RIFF')).toBe(true);
    expect(header).toContain('WEBP');
    expect(MAX_PIXELS).toBe(50000000);
  });

  it('passes through WebP under target unchanged', async () => {
    const input = await Bun.file(FIXTURE).bytes();
    const webp = await new Bun.Image(input).webp({ quality: 80 }).bytes();

    const result = await prepareImage('/tmp/does-not-matter.webp', {
      readFile: async () => webp,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bytes).toEqual(webp);
    }
  });

  it('re-encodes PNG over 1MB to WebP q80', async () => {
    const input = await Bun.file(FIXTURE).bytes();
    const bigPng = await new Bun.Image(input)
      .resize(2000, 2000, { fit: 'fill' })
      .png({ compressionLevel: 0 })
      .bytes();
    expect(bigPng.length).toBeGreaterThan(1024 * 1024);

    const output = await toWebp(bigPng, 80);

    const header = new TextDecoder().decode(output.subarray(0, 12));
    expect(header).toContain('WEBP');
    expect(output.length).toBeLessThan(bigPng.length);
  });

  it('throws on >50Mpx input', async () => {
    const fakePng = fakePngHeader(10000, 6000); // 60,000,000 px

    await expect(toWebp(fakePng)).rejects.toMatchObject({
      code: 'ERR_IMAGE_TOO_MANY_PIXELS',
    });
  });

  it('rejects HEIC with one-line message', async () => {
    const fakeHeic = new Uint8Array(32);
    fakeHeic.set([0x00, 0x00, 0x00, 0x18], 0);
    fakeHeic.set(new TextEncoder().encode('ftypheic'), 4);

    await expect(toWebp(fakeHeic)).rejects.toMatchObject({
      code: 'ERR_IMAGE_FORMAT_UNSUPPORTED',
    });
  });
});
