import { describe, expect, test } from 'bun:test';

import { shareLinks } from './share';

describe('shareLinks', () => {
  test('builds WhatsApp, X and LinkedIn links from url and title', () => {
    const links = shareLinks('https://example.test/d/abc', 'My Doc');

    expect(links.whatsapp).toBe(
      `https://wa.me/?text=${encodeURIComponent('My Doc https://example.test/d/abc')}`
    );
    expect(links.twitter).toBe(
      `https://twitter.com/intent/tweet?url=${encodeURIComponent('https://example.test/d/abc')}&text=${encodeURIComponent('My Doc')}`
    );
    expect(links.linkedin).toBe(
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent('https://example.test/d/abc')}`
    );
  });

  test('encodes special characters in the title and url', () => {
    const links = shareLinks('https://example.test/d/abc?x=1&y=2', 'A & B "quotes"');

    expect(links.whatsapp).not.toContain('&y=2');
    expect(links.whatsapp).toContain(encodeURIComponent('A & B "quotes" https://example.test/d/abc?x=1&y=2'));
    expect(links.twitter).toContain(encodeURIComponent('https://example.test/d/abc?x=1&y=2'));
    expect(links.twitter).toContain(encodeURIComponent('A & B "quotes"'));
    expect(links.linkedin).toContain(encodeURIComponent('https://example.test/d/abc?x=1&y=2'));
  });
});
