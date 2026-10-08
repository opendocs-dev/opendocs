import { describe, expect, test } from 'bun:test';

import type { GetDocResponse } from '@opendocs/core';

import { buildDocMetadata } from './metadata';

function doc(overrides: Partial<GetDocResponse> = {}): GetDocResponse {
  return {
    public_id: 'abc',
    title: 'My Doc',
    steps: [
      { order: 1, action: 'click', instruction: 'Click the button', image: { url: 'https://example.test/1.png', expired: false } },
      { order: 2, action: 'click', instruction: 'Then save', image: { url: null, expired: false } },
    ],
    ...overrides,
  };
}

describe('buildDocMetadata', () => {
  test('sets title, description and robots noindex', () => {
    const metadata = buildDocMetadata(doc(), 'https://example.test/d/abc');

    expect(metadata.title).toBe('My Doc');
    expect(metadata.description).toBe('2 steps · Click the button');
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  test('sets openGraph title/description and twitter card', () => {
    const metadata = buildDocMetadata(doc(), 'https://example.test/d/abc');

    expect(metadata.openGraph?.title).toBe('My Doc');
    expect(metadata.openGraph?.description).toBe('2 steps · Click the button');
    expect(metadata.twitter).toEqual({ card: 'summary_large_image' });
  });

  test('uses the first step image as og:image when present and not expired', () => {
    const metadata = buildDocMetadata(doc(), 'https://example.test/d/abc');

    expect(metadata.openGraph?.images).toEqual([{ url: 'https://example.test/1.png' }]);
  });

  test('sets openGraph.url from the given url', () => {
    const metadata = buildDocMetadata(doc(), 'https://example.test/d/abc');

    expect(metadata.openGraph?.url).toBe('https://example.test/d/abc');
  });

  test('omits og:url and og:image when url is null (no trusted origin)', () => {
    const metadata = buildDocMetadata(doc(), null);

    expect(metadata.openGraph?.url).toBeUndefined();
    expect(metadata.openGraph?.images).toBeUndefined();
  });

  test('no og:image when first image expired', () => {
    const withExpiredImage = doc({
      steps: [
        {
          order: 1,
          action: 'click',
          instruction: 'Click the button',
          image: { url: 'https://example.test/1.png', expired: true },
        },
      ],
    });

    const metadata = buildDocMetadata(withExpiredImage, 'https://example.test/d/abc');

    expect(metadata.openGraph?.images).toBeUndefined();
  });

  test('no og:image when first image url is missing', () => {
    const withoutImage = doc({
      steps: [
        { order: 1, action: 'click', instruction: 'Click the button', image: { url: null, expired: false } },
      ],
    });

    const metadata = buildDocMetadata(withoutImage, 'https://example.test/d/abc');

    expect(metadata.openGraph?.images).toBeUndefined();
  });

  test('no og:image when there are no steps', () => {
    const noSteps = doc({ steps: [] });

    const metadata = buildDocMetadata(noSteps, 'https://example.test/d/abc');

    expect(metadata.openGraph?.images).toBeUndefined();
    expect(metadata.description).toBe('0 steps');
  });

  test('truncates description to 160 characters', () => {
    const longInstruction = 'x'.repeat(200);
    const withLongStep = doc({
      steps: [{ order: 1, action: 'click', instruction: longInstruction, image: { url: null, expired: false } }],
    });

    const metadata = buildDocMetadata(withLongStep, 'https://example.test/d/abc');

    expect((metadata.description as string).length).toBeLessThanOrEqual(160);
  });

  test('prefers seo_title over title when set', () => {
    const metadata = buildDocMetadata({ ...doc(), seo_title: 'Custom SEO Title' }, 'https://example.test/d/abc');

    expect(metadata.title).toBe('Custom SEO Title');
    expect(metadata.openGraph?.title).toBe('Custom SEO Title');
  });

  test('falls back to title when seo_title is empty or absent', () => {
    const metadata = buildDocMetadata({ ...doc(), seo_title: '' }, 'https://example.test/d/abc');

    expect(metadata.title).toBe('My Doc');
  });

  test('prefers seo_description over the step-derived description', () => {
    const metadata = buildDocMetadata(
      { ...doc(), seo_description: 'Custom SEO description' },
      'https://example.test/d/abc',
    );

    expect(metadata.description).toBe('Custom SEO description');
    expect(metadata.openGraph?.description).toBe('Custom SEO description');
  });

  test('truncates seo_description to 160 characters', () => {
    const metadata = buildDocMetadata(
      { ...doc(), seo_description: 'x'.repeat(200) },
      'https://example.test/d/abc',
    );

    expect((metadata.description as string).length).toBeLessThanOrEqual(160);
  });

  test('uses the fallback image when the guide has no step image of its own', () => {
    const noImageDoc = doc({
      steps: [{ order: 1, action: 'click', instruction: 'Click the button', image: { url: null, expired: false } }],
    });

    const metadata = buildDocMetadata(noImageDoc, 'https://example.test/d/abc', 'https://example.test/site-share.png');

    expect(metadata.openGraph?.images).toEqual([{ url: 'https://example.test/site-share.png' }]);
  });

  test('prefers the guide step image over the fallback image when both exist', () => {
    const metadata = buildDocMetadata(doc(), 'https://example.test/d/abc', 'https://example.test/site-share.png');

    expect(metadata.openGraph?.images).toEqual([{ url: 'https://example.test/1.png' }]);
  });

  test('omits og:image when there is no step image and no fallback', () => {
    const noImageDoc = doc({
      steps: [{ order: 1, action: 'click', instruction: 'Click the button', image: { url: null, expired: false } }],
    });

    const metadata = buildDocMetadata(noImageDoc, 'https://example.test/d/abc');

    expect(metadata.openGraph?.images).toBeUndefined();
  });
});
