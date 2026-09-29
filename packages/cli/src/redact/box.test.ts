import { expect, test } from 'bun:test';
import { computeBoxFromTarget, type TargetRect } from './box';

test('target box scales x2 for 2560px image of 1280px viewport', () => {
  const target: TargetRect = { x: 100, y: 50, w: 40, h: 20, vw: 1280, vh: 800, sx: 0, sy: 0 };
  const box = computeBoxFromTarget(target, 2560, 1600);
  expect(box).toEqual({ x: 200, y: 100, w: 80, h: 40 });
});

test('full-page image adds scroll offset', () => {
  // Viewport 1280x800 at scale 1, but the image is much taller than the
  // viewport (3200px) - a full-page capture - so the page's scroll offset
  // (300px down) must be folded into the target position before scaling.
  const target: TargetRect = { x: 100, y: 50, w: 40, h: 20, vw: 1280, vh: 800, sx: 0, sy: 300 };
  const box = computeBoxFromTarget(target, 1280, 3200);
  expect(box).toEqual({ x: 100, y: 350, w: 40, h: 20 });
});

test('short screenshot is not treated as full-page', () => {
  const target: TargetRect = { x: 100, y: 50, w: 40, h: 20, vw: 1280, vh: 800, sx: 0, sy: 300 };
  const box = computeBoxFromTarget(target, 1280, 800);
  expect(box).toEqual({ x: 100, y: 50, w: 40, h: 20 });
});

test('clamps box to image bounds', () => {
  const target: TargetRect = { x: 1250, y: 780, w: 100, h: 100, vw: 1280, vh: 800, sx: 0, sy: 0 };
  const box = computeBoxFromTarget(target, 1280, 800);
  expect(box).toBeDefined();
  expect(box!.x + box!.w).toBeLessThanOrEqual(1280);
  expect(box!.y + box!.h).toBeLessThanOrEqual(800);
});

test('zero-area box is dropped', () => {
  // Target sits right at the right edge: after clamping to the image bounds
  // the box has zero width, so no highlight box should be sent at all.
  const target: TargetRect = { x: 1280, y: 50, w: 40, h: 20, vw: 1280, vh: 800, sx: 0, sy: 0 };
  const box = computeBoxFromTarget(target, 1280, 800);
  expect(box).toBeUndefined();
});

test('sub-2px box is dropped even without clamping', () => {
  const target: TargetRect = { x: 100, y: 50, w: 1, h: 1, vw: 1280, vh: 800, sx: 0, sy: 0 };
  const box = computeBoxFromTarget(target, 1280, 800);
  expect(box).toBeUndefined();
});
