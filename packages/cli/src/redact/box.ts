/**
 * Turns a target element's viewport rect (as reported by the redaction script,
 * in CSS px) into a highlight box in the uploaded screenshot's pixel space.
 *
 * The doc page draws `box` as a percentage of the stored image's pixel
 * width/height, so the scale factor is image px / viewport CSS px. A
 * screenshot much taller than the viewport (a full-page capture) also needs
 * the page's scroll offset added before scaling.
 */
import type { Box } from '@opendocs/core/contract';

export interface TargetRect {
  x: number;
  y: number;
  w: number;
  h: number;
  vw: number;
  vh: number;
  sx: number;
  sy: number;
}

/** A screenshot taller than this multiple of the viewport is treated as full-page. */
const FULL_PAGE_HEIGHT_FACTOR = 1.2;

/** Clamp a box so it never extends past the image's bounds. */
function clampBox(box: Box, imageWidth: number, imageHeight: number): Box {
  const x = Math.max(0, Math.min(box.x, imageWidth));
  const y = Math.max(0, Math.min(box.y, imageHeight));
  const w = Math.max(0, Math.min(box.w, imageWidth - x));
  const h = Math.max(0, Math.min(box.h, imageHeight - y));
  return { x, y, w, h };
}

/**
 * Compute the highlight box in image pixels for a target rect measured in the
 * live page (CSS px, viewport-relative).
 *
 * @param target The target rect from a redaction report.
 * @param imageWidth Width in pixels of the uploaded (already-compressed) image.
 * @param imageHeight Height in pixels of the uploaded (already-compressed) image.
 */
export function computeBoxFromTarget(target: TargetRect, imageWidth: number, imageHeight: number): Box {
  const scale = imageWidth / target.vw;
  const isFullPage = imageHeight / scale > target.vh * FULL_PAGE_HEIGHT_FACTOR;
  const x = isFullPage ? target.x + target.sx : target.x;
  const y = isFullPage ? target.y + target.sy : target.y;

  const box: Box = {
    x: Math.round(x * scale),
    y: Math.round(y * scale),
    w: Math.round(target.w * scale),
    h: Math.round(target.h * scale),
  };
  return clampBox(box, imageWidth, imageHeight);
}
