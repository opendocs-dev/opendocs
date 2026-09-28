import { describe, expect, it } from 'bun:test';
import { MAX_PIXELS } from '@opendocs/core/limits';
import { toWebp } from './compress';

// URL (not .pathname) so the fixture resolves on Windows runners too.
const FIXTURE = new URL('../test/fixtures/sample.png', import.meta.url);

describe('toWebp', () => {
  it('encodes PNG fixture to WebP under maxPixels', async () => {
    const input = await Bun.file(FIXTURE).bytes();
    const output = await toWebp(input);

    const header = new TextDecoder().decode(output.subarray(0, 12));
    expect(header.startsWith('RIFF')).toBe(true);
    expect(header).toContain('WEBP');
    expect(MAX_PIXELS).toBe(50000000);
  });
});
