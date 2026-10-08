import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { DocStep } from '@opendocs/core';

import { computeLightboxView, hasImage, Lightbox, nextIndex, prevIndex, stepAltText } from './lightbox';

function step(order: number, hasUrl: boolean, expired = false, alt?: string): DocStep {
  return {
    order,
    action: 'click',
    instruction: `Step ${order}`,
    ...(alt ? { alt } : {}),
    image: { url: hasUrl ? `https://example.test/${order}.png` : null, expired },
  };
}

function stepWithBox(order: number): DocStep {
  return {
    order,
    action: 'click',
    instruction: `Step ${order}`,
    box: { x: 1000, y: 600, w: 100, h: 50 },
    image: { url: `https://example.test/${order}.png`, expired: false, width: 2880, height: 1434 },
  };
}

describe('hasImage', () => {
  test('true when url present and not expired', () => {
    expect(hasImage(step(1, true))).toBe(true);
  });

  test('false when url missing', () => {
    expect(hasImage(step(1, false))).toBe(false);
  });

  test('false when expired', () => {
    expect(hasImage(step(1, true, true))).toBe(false);
  });
});

describe('nextIndex', () => {
  test('moves to the next step that has an image', () => {
    const steps = [step(1, true), step(2, false), step(3, true)];
    expect(nextIndex(steps, 0)).toBe(2);
  });

  test('stays put when no later step has an image', () => {
    const steps = [step(1, true), step(2, false)];
    expect(nextIndex(steps, 0)).toBe(0);
  });
});

describe('prevIndex', () => {
  test('moves to the previous step that has an image', () => {
    const steps = [step(1, true), step(2, false), step(3, true)];
    expect(prevIndex(steps, 2)).toBe(0);
  });

  test('stays put when no earlier step has an image', () => {
    const steps = [step(1, false), step(2, true)];
    expect(prevIndex(steps, 1)).toBe(1);
  });
});

describe('stepAltText', () => {
  test('uses step.alt when present', () => {
    expect(stepAltText(step(1, true, false, 'A screenshot of the login form'))).toBe(
      'A screenshot of the login form'
    );
  });

  test('falls back to "Step N" when alt is missing', () => {
    expect(stepAltText(step(3, true))).toBe('Step 3');
  });
});

describe('Lightbox', () => {
  test('renders a closed dialog with no content when nothing is open', () => {
    const steps = [step(1, true)];
    const html = renderToStaticMarkup(<Lightbox steps={steps} />);

    expect(html).toContain('<dialog');
    expect(html).not.toContain('step-lightbox-body');
  });
});

describe('computeLightboxView', () => {
  test('returns no placement or overlay when there is no box', () => {
    expect(computeLightboxView(step(1, true), 'zoom', null)).toEqual({ placement: null, overlay: null });
  });

  test('returns no placement or overlay when step is null', () => {
    expect(computeLightboxView(null, 'zoom', null)).toEqual({ placement: null, overlay: null });
  });

  test('zoom mode: has a placement (so Ring/Pin render) and a crop-relative overlay', () => {
    const view = computeLightboxView(stepWithBox(2), 'zoom', 1024);

    expect(view.placement).not.toBeNull();
    expect(view.overlay).not.toBeNull();
  });

  test('fit mode: has no placement but still has an image-relative overlay (so the pin renders)', () => {
    const view = computeLightboxView(stepWithBox(2), 'fit', 1024);

    expect(view.placement).toBeNull();
    expect(view.overlay).not.toBeNull();
  });

  test('narrow dialog widths (< 600) produce a tighter crop in zoom mode', () => {
    const narrow = computeLightboxView(stepWithBox(2), 'zoom', 320);
    const wide = computeLightboxView(stepWithBox(2), 'zoom', 1024);

    // A tighter crop means the full image is placed at a larger widthPercent
    // (it's stretched more to fill the same-aspect wrapper).
    expect(narrow.placement!.widthPercent).toBeGreaterThan(wide.placement!.widthPercent);
  });
});
