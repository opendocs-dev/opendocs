import { describe, expect, test } from 'bun:test';

import { boxInCrop, cropRect, lightboxMinSize, loupeCropRect, loupePlacement, zoomPlacement } from './crop';

const ASPECT = 16 / 9;

describe('cropRect', () => {
  test('contains the box plus padding', () => {
    const box = { x: 1000, y: 600, w: 100, h: 50 };
    const padding = Math.max(Math.max(box.w, box.h) * 0.75, 80);
    const crop = cropRect(box, 2880, 1434, ASPECT);

    expect(box.x - crop.x).toBeGreaterThanOrEqual(padding);
    expect(box.y - crop.y).toBeGreaterThanOrEqual(padding);
    expect(crop.x + crop.w - (box.x + box.w)).toBeGreaterThanOrEqual(padding);
    expect(crop.y + crop.h - (box.y + box.h)).toBeGreaterThanOrEqual(padding);
    expect(crop.w / crop.h).toBeCloseTo(ASPECT, 5);
  });

  test('clamps at image edges instead of overflowing', () => {
    const box = { x: 10, y: 10, w: 20, h: 20 };
    const crop = cropRect(box, 800, 450, ASPECT);

    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.w).toBeLessThanOrEqual(800);
    expect(crop.y + crop.h).toBeLessThanOrEqual(450);
    expect(crop).toEqual({ x: 0, y: 0, w: 480, h: 270 });
  });

  test('grows a small box up to the minimum crop size', () => {
    const box = { x: 1000, y: 1000, w: 10, h: 10 };
    const crop = cropRect(box, 3000, 2000, ASPECT);

    expect(crop.w).toBe(480);
    expect(crop.h).toBe(270);
    expect(crop.w / crop.h).toBeCloseTo(ASPECT, 5);
  });

  test('expands past the minimum for a box larger than it, keeping aspect', () => {
    const box = { x: 500, y: 500, w: 600, h: 200 };
    const crop = cropRect(box, 5000, 3000, ASPECT);

    expect(crop.w).toBeGreaterThan(600);
    expect(crop.h).toBeGreaterThan(200);
    expect(crop.w / crop.h).toBeCloseTo(ASPECT, 5);
    expect(box.x - crop.x).toBeGreaterThanOrEqual(0);
    expect(box.y - crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.w).toBeGreaterThanOrEqual(box.x + box.w);
    expect(crop.y + crop.h).toBeGreaterThanOrEqual(box.y + box.h);
  });

  test('shrinks to fit an image smaller than the minimum crop size', () => {
    const box = { x: 20, y: 20, w: 40, h: 40 };
    const crop = cropRect(box, 300, 200, ASPECT);

    expect(crop.x).toBe(0);
    expect(crop.y).toBe(0);
    expect(crop.w).toBeLessThanOrEqual(300);
    expect(crop.h).toBeLessThanOrEqual(200);
    expect(crop.w / crop.h).toBeCloseTo(ASPECT, 5);
  });

  test('keeps exact 16:9 aspect for a narrow portrait image, so zoomPlacement stays exact', () => {
    const box = { x: 100, y: 200, w: 40, h: 40 };
    const crop = cropRect(box, 375, 667, ASPECT);

    expect(crop.w / crop.h).toBeCloseTo(ASPECT, 5);
    expect(crop.w).toBeLessThanOrEqual(375);
    expect(crop.h).toBeLessThanOrEqual(667);

    const placement = zoomPlacement(375, crop);
    // Rendered crop region (in wrapper px, wrapper width = crop.w) must equal
    // the computed crop: the image's rendered box, intersected with the
    // wrapper, matches crop exactly since aspect is preserved.
    const wrapperW = crop.w;
    const wrapperH = crop.h;
    const imgRenderedW = (placement.widthPercent / 100) * wrapperW;
    const imgRenderedLeft = (placement.leftPercent / 100) * wrapperW;
    const imgRenderedTop = (placement.topPercent / 100) * wrapperH;

    expect(imgRenderedW).toBeCloseTo(375, 5);
    expect(imgRenderedLeft).toBeCloseTo(-crop.x, 5);
    expect(imgRenderedTop).toBeCloseTo(-crop.y, 5);
  });
});

describe('lightboxMinSize', () => {
  test('uses the default minimum at or above 600px', () => {
    expect(lightboxMinSize(600)).toEqual({ width: 480, height: 270 });
    expect(lightboxMinSize(1024)).toEqual({ width: 480, height: 270 });
  });

  test('uses a smaller minimum below 600px', () => {
    expect(lightboxMinSize(599)).toEqual({ width: 240, height: 135 });
    expect(lightboxMinSize(320)).toEqual({ width: 240, height: 135 });
  });
});

describe('cropRect with a custom minSize', () => {
  test('a small target fills more of a narrow lightbox crop than the default minimum', () => {
    const box = { x: 1000, y: 600, w: 60, h: 40 };
    const defaultCrop = cropRect(box, 3000, 2000, ASPECT);
    const narrowCrop = cropRect(box, 3000, 2000, ASPECT, lightboxMinSize(320));

    expect(narrowCrop.w).toBeLessThan(defaultCrop.w);
    expect(box.w / narrowCrop.w).toBeGreaterThan(box.w / defaultCrop.w);
  });

  test('grows a small box up to the narrow lightbox minimum, keeping aspect', () => {
    const box = { x: 1000, y: 1000, w: 10, h: 10 };
    const narrowMin = lightboxMinSize(320);
    const defaultCrop = cropRect(box, 3000, 2000, ASPECT);
    const crop = cropRect(box, 3000, 2000, ASPECT, narrowMin);

    expect(crop.w).toBeLessThan(defaultCrop.w);
    expect(crop.h).toBeLessThan(defaultCrop.h);
    expect(crop.w / crop.h).toBeCloseTo(ASPECT, 5);
  });

  test('falls back to the default minimum when minSize is omitted', () => {
    const box = { x: 1000, y: 1000, w: 10, h: 10 };
    const crop = cropRect(box, 3000, 2000, ASPECT);

    expect(crop.w).toBe(480);
    expect(crop.h).toBe(270);
  });
});

describe('boxInCrop', () => {
  test('re-expresses the box relative to the crop origin', () => {
    const box = { x: 1000, y: 600, w: 100, h: 50 };
    const crop = { x: 810, y: 490, w: 480, h: 270 };

    expect(boxInCrop(box, crop)).toEqual({ x: 190, y: 110, w: 100, h: 50 });
  });
});

describe('zoomPlacement', () => {
  test('computes percentages that place the full image so the crop fills the wrapper', () => {
    const crop = { x: 810, y: 490, w: 480, h: 270 };
    const placement = zoomPlacement(2880, crop);

    expect(placement.widthPercent).toBeCloseTo((2880 / 480) * 100, 5);
    expect(placement.leftPercent).toBeCloseTo((-810 / 480) * 100, 5);
    expect(placement.topPercent).toBeCloseTo((-490 / 270) * 100, 5);
  });
});

describe('loupeCropRect', () => {
  const ASPECT16_9 = 16 / 9;

  test('contains the box plus 0.9x padding', () => {
    const box = { x: 1000, y: 600, w: 100, h: 50 };
    const padding = Math.max(box.w, box.h) * 0.9;
    const crop = loupeCropRect(box, 2880, 1434);

    expect(box.x - crop.x).toBeGreaterThanOrEqual(padding - 1e-6);
    expect(box.y - crop.y).toBeGreaterThanOrEqual(padding - 1e-6);
    expect(crop.x + crop.w - (box.x + box.w)).toBeGreaterThanOrEqual(padding - 1e-6);
    expect(crop.w / crop.h).toBeCloseTo(ASPECT16_9, 5);
  });

  test('grows a small box up to the 560px minimum width', () => {
    const box = { x: 1000, y: 1000, w: 10, h: 10 };
    const crop = loupeCropRect(box, 3000, 2000);

    expect(crop.w).toBe(560);
    expect(crop.w / crop.h).toBeCloseTo(ASPECT16_9, 5);
  });

  test('expands past the minimum for a box larger than it, keeping aspect', () => {
    const box = { x: 500, y: 500, w: 600, h: 400 };
    const crop = loupeCropRect(box, 5000, 3000);

    expect(crop.w).toBeGreaterThan(560);
    expect(crop.w / crop.h).toBeCloseTo(ASPECT16_9, 5);
    expect(crop.x + crop.w).toBeGreaterThanOrEqual(box.x + box.w);
    expect(crop.y + crop.h).toBeGreaterThanOrEqual(box.y + box.h);
  });

  test('shrinks to fit an image narrower than the minimum crop width', () => {
    const box = { x: 20, y: 20, w: 40, h: 40 };
    const crop = loupeCropRect(box, 300, 200);

    expect(crop.w).toBeLessThanOrEqual(300);
    expect(crop.w / crop.h).toBeCloseTo(ASPECT16_9, 5);
  });

  test('shrinks both dimensions together for a short/wide image, keeping y non-negative', () => {
    const box = { x: 20, y: 20, w: 30, h: 30 };
    const crop = loupeCropRect(box, 300, 100);

    expect(crop.w).toBeLessThanOrEqual(300);
    expect(crop.h).toBeLessThanOrEqual(100);
    expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.w / crop.h).toBeCloseTo(ASPECT16_9, 5);
  });

  test('clamps at image edges instead of overflowing', () => {
    const box = { x: 5, y: 5, w: 20, h: 20 };
    const crop = loupeCropRect(box, 2880, 1434);

    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.w).toBeLessThanOrEqual(2880);
    expect(crop.y + crop.h).toBeLessThanOrEqual(1434);
  });
});

describe('loupePlacement', () => {
  test('box in the right half of a top-heavy image -> loupe hangs left/bottom', () => {
    expect(loupePlacement({ x: 2000, y: 100, w: 50, h: 50 }, 2880, 1434)).toEqual({ side: 'l', vert: 'b' });
  });

  test('box in the left half of a bottom-heavy image -> loupe hangs right/top', () => {
    expect(loupePlacement({ x: 100, y: 1200, w: 50, h: 50 }, 2880, 1434)).toEqual({ side: 'r', vert: 't' });
  });

  test('box exactly centered defaults to right/bottom (not greater-than on either axis)', () => {
    expect(loupePlacement({ x: 1415, y: 692, w: 50, h: 50 }, 2880, 1434)).toEqual({ side: 'r', vert: 'b' });
  });
});
