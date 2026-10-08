import type { Box } from '@opendocs/core';

export type Rect = { x: number; y: number; w: number; h: number };

export type ZoomPlacement = { widthPercent: number; leftPercent: number; topPercent: number };

export type OverlayRect = { left: number; top: number; width: number; height: number };

const MIN_WIDTH = 480;
const MIN_HEIGHT = 270;
const DEFAULT_ASPECT = 16 / 9;

const LIGHTBOX_NARROW_BREAKPOINT = 600;
const LIGHTBOX_NARROW_MIN_WIDTH = 240;
const LIGHTBOX_NARROW_MIN_HEIGHT = 135;

export type MinSize = { width: number; height: number };

const DEFAULT_MIN_SIZE: MinSize = { width: MIN_WIDTH, height: MIN_HEIGHT };

/**
 * Crop rect (image px) that contains `box` plus padding, matches `aspect`,
 * is at least `minSize`, and stays inside the image (shifted first, shrunk
 * per-dimension only if the image itself is smaller than the crop).
 */
export function cropRect(
  box: Box,
  imgW: number,
  imgH: number,
  aspect: number = DEFAULT_ASPECT,
  minSize: MinSize = DEFAULT_MIN_SIZE
): Rect {
  const padding = Math.max(Math.max(box.w, box.h) * 0.75, 80);

  const left0 = box.x - padding;
  const top0 = box.y - padding;
  const right0 = box.x + box.w + padding;
  const bottom0 = box.y + box.h + padding;

  let width = Math.max(right0 - left0, minSize.width);
  let height = Math.max(bottom0 - top0, minSize.height);

  if (width / height > aspect) {
    height = width / aspect;
  } else {
    width = height * aspect;
  }

  const centerX = (left0 + right0) / 2;
  const centerY = (top0 + bottom0) / 2;

  let x = centerX - width / 2;
  let y = centerY - height / 2;

  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x + width > imgW) x = Math.max(0, imgW - width);
  if (y + height > imgH) y = Math.max(0, imgH - height);

  // If the crop still doesn't fit (image smaller than the crop in some
  // dimension), shrink both sides together so the crop keeps `aspect`
  // exactly, instead of clamping width/height independently.
  if (width > imgW || height > imgH) {
    width = Math.min(imgW, imgH * aspect);
    height = width / aspect;
    x = 0;
    y = 0;
  }

  return { x, y, w: width, h: height };
}

/**
 * Minimum crop size to use for the lightbox: a smaller floor when the
 * dialog itself is narrower than `LIGHTBOX_NARROW_BREAKPOINT`, so small
 * targets aren't shrunk down to a sliver of the available width.
 */
export function lightboxMinSize(dialogWidth: number): MinSize {
  if (dialogWidth < LIGHTBOX_NARROW_BREAKPOINT) {
    return { width: LIGHTBOX_NARROW_MIN_WIDTH, height: LIGHTBOX_NARROW_MIN_HEIGHT };
  }
  return DEFAULT_MIN_SIZE;
}

/** `box` re-expressed relative to `crop`'s top-left corner, in image px. */
export function boxInCrop(box: Box, crop: Rect): Box {
  return { x: box.x - crop.x, y: box.y - crop.y, w: box.w, h: box.h };
}

/**
 * Percentages for absolutely positioning the full image inside a wrapper
 * that only shows `crop` (wrapper aspect ratio must match `crop`'s aspect).
 */
export function zoomPlacement(imgW: number, crop: Rect): ZoomPlacement {
  return {
    widthPercent: (imgW / crop.w) * 100,
    leftPercent: (-crop.x / crop.w) * 100,
    topPercent: (-crop.y / crop.h) * 100,
  };
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/** Converts a pixel box to a percentage overlay relative to a `width` x `height` frame. */
export function overlayPercent(
  box: Box | undefined,
  width: number | undefined,
  height: number | undefined
): OverlayRect | null {
  if (!box || !width || !height) return null;

  const left = clampPercent((box.x / width) * 100);
  const top = clampPercent((box.y / height) * 100);
  const rawWidth = clampPercent((box.w / width) * 100);
  const rawHeight = clampPercent((box.h / height) * 100);

  return {
    left,
    top,
    width: Math.max(0, Math.min(rawWidth, 100 - left)),
    height: Math.max(0, Math.min(rawHeight, 100 - top)),
  };
}

const LOUPE_ASPECT = 16 / 9;
const LOUPE_MIN_WIDTH = 560;
const LOUPE_PADDING_FACTOR = 0.9;

export type LoupeSide = 'l' | 'r';
export type LoupeVert = 't' | 'b';

/**
 * Crop rect (image px) for the step-body loupe: contains `box` plus padding
 * proportional to its size, at least `LOUPE_MIN_WIDTH` wide, matching the
 * owner-approved prototype's crop math exactly (0.9 padding, 560px floor)
 * rather than the lightbox's fixed-padding/min-size crop above.
 */
export function loupeCropRect(box: Box, imgW: number, imgH: number, aspect: number = LOUPE_ASPECT): Rect {
  const padding = Math.max(box.w, box.h) * LOUPE_PADDING_FACTOR;

  let width = Math.max(box.w + padding * 2, LOUPE_MIN_WIDTH);
  let height = width / aspect;

  if (height < box.h + padding * 2) {
    height = box.h + padding * 2;
    width = height * aspect;
  }

  // If the crop doesn't fit the image in either dimension, shrink both sides
  // together so the crop keeps `aspect` exactly (mirrors cropRect's combined
  // shrink), instead of only capping width and letting height overflow on
  // short/wide images.
  if (width > imgW || height > imgH) {
    width = Math.min(imgW, imgH * aspect);
    height = width / aspect;
  }

  let x = box.x + box.w / 2 - width / 2;
  let y = box.y + box.h / 2 - height / 2;

  x = Math.min(Math.max(0, x), imgW - width);
  y = Math.min(Math.max(0, y), imgH - height);

  return { x, y, w: width, h: height };
}

/**
 * Which side/corner to hang the loupe off of: the horizontal side away from
 * the box's center, and the vertical side away from it, so the loupe never
 * covers the highlighted target.
 */
export function loupePlacement(box: Box, imgW: number, imgH: number): { side: LoupeSide; vert: LoupeVert } {
  const side: LoupeSide = box.x + box.w / 2 > imgW / 2 ? 'l' : 'r';
  const vert: LoupeVert = box.y + box.h / 2 > imgH / 2 ? 't' : 'b';

  return { side, vert };
}
