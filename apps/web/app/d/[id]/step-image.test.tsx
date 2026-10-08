import { describe, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';

import { overlayPercent } from '@/lib/crop';
import { InlineBold, StepImage, StepList } from './step-image';

describe('overlayPercent', () => {
  test('converts a pixel box to a percentage overlay', () => {
    expect(overlayPercent({ x: 100, y: 50, w: 200, h: 100 }, 1000, 500)).toEqual({
      left: 10,
      top: 10,
      width: 20,
      height: 20,
    });
  });

  test('clamps an out-of-range box to 100%', () => {
    expect(overlayPercent({ x: 900, y: 900, w: 500, h: 500 }, 1000, 1000)).toEqual({
      left: 90,
      top: 90,
      width: 10,
      height: 10,
    });
  });

  test('returns null when box is missing', () => {
    expect(overlayPercent(undefined, 1000, 500)).toBeNull();
  });

  test('returns null when width or height is missing', () => {
    expect(overlayPercent({ x: 0, y: 0, w: 10, h: 10 }, undefined, 500)).toBeNull();
    expect(overlayPercent({ x: 0, y: 0, w: 10, h: 10 }, 1000, undefined)).toBeNull();
  });

  test('returns null when width or height is zero', () => {
    expect(overlayPercent({ x: 0, y: 0, w: 10, h: 10 }, 0, 500)).toBeNull();
    expect(overlayPercent({ x: 0, y: 0, w: 10, h: 10 }, 1000, 0)).toBeNull();
  });
});

describe('StepImage', () => {
  test('renders a placeholder and skips the ring when expired is true', () => {
    const html = renderToStaticMarkup(
      <StepImage
        order={1}
        box={{ x: 10, y: 10, w: 20, h: 20 }}
        image={{ url: 'https://example.test/img.png', expired: true, width: 100, height: 100 }}
      />
    );

    expect(html).toContain('Image no longer available');
    expect(html).not.toContain('class="ring"');
    expect(html).not.toContain('<img');
  });

  test('placeholder includes an icon', () => {
    const html = renderToStaticMarkup(
      <StepImage order={1} image={{ url: 'https://example.test/img.png', expired: true }} />
    );

    expect(html).toContain('<svg');
    expect(html).toContain('aria-hidden="true"');
  });
});

describe('StepImage frame + loupe', () => {
  test('renders the frame, ring and loupe when box exists', () => {
    const html = renderToStaticMarkup(
      <StepImage
        order={2}
        box={{ x: 1000, y: 600, w: 100, h: 50 }}
        pageUrl="https://acme.my.id/checkout"
        image={{ url: 'https://example.test/img.png', expired: false, width: 2880, height: 1434 }}
      />
    );

    expect(html).toContain('class="frame"');
    expect(html).toContain('class="frame-bar"');
    expect(html).toContain('<b>acme.my.id</b>/checkout');
    expect(html).toContain('class="ring"');
    expect(html).toContain('class="pin"');
    expect(html).toContain('aria-label="Open step 2 full screenshot"');
    expect(html).toContain('aria-label="Zoom in on step 2"');
    expect(html.match(/<img/g)?.length).toBe(2);
  });

  test('loupe hangs on the side and vertical edge away from the box', () => {
    const html = renderToStaticMarkup(
      <StepImage
        order={1}
        box={{ x: 2000, y: 100, w: 50, h: 50 }}
        image={{ url: 'https://example.test/img.png', expired: false, width: 2880, height: 1434 }}
      />
    );

    expect(html).toContain('class="loupe l b"');
  });

  test('no frame/loupe markup without box, just the plain frame', () => {
    const html = renderToStaticMarkup(
      <StepImage
        order={1}
        image={{ url: 'https://example.test/img.png', expired: false, width: 2880, height: 1434 }}
      />
    );

    expect(html).not.toContain('class="loupe');
    expect(html).not.toContain('class="ring"');
    expect(html).toContain('class="frame"');
  });

  test('alt text from the step', () => {
    const html = renderToStaticMarkup(
      <StepImage
        order={1}
        alt="A screenshot of the login form"
        image={{ url: 'https://example.test/img.png', expired: false, width: 2880, height: 1434 }}
      />
    );

    expect(html).toContain('alt="A screenshot of the login form"');
    expect(html).not.toContain('alt="Step 1"');
  });

  test('falls back to "Step N" alt when the step has no alt', () => {
    const html = renderToStaticMarkup(
      <StepImage
        order={1}
        image={{ url: 'https://example.test/img.png', expired: false, width: 2880, height: 1434 }}
      />
    );

    expect(html).toContain('alt="Step 1"');
  });

  test('iframe note when no box', () => {
    const html = renderToStaticMarkup(
      <StepImage
        order={1}
        iframes={2}
        image={{ url: 'https://example.test/img.png', expired: false, width: 2880, height: 1434 }}
      />
    );

    expect(html).toContain('step-image-iframe-note');
    expect(html).toContain('No highlight: this step happens inside an embedded frame.');
  });

  test('no iframe note when a box is present', () => {
    const html = renderToStaticMarkup(
      <StepImage
        order={1}
        box={{ x: 10, y: 10, w: 20, h: 20 }}
        iframes={2}
        image={{ url: 'https://example.test/img.png', expired: false, width: 2880, height: 1434 }}
      />
    );

    expect(html).not.toContain('step-image-iframe-note');
  });

  test('no iframe note when iframes is zero', () => {
    const html = renderToStaticMarkup(
      <StepImage
        order={1}
        iframes={0}
        image={{ url: 'https://example.test/img.png', expired: false, width: 2880, height: 1434 }}
      />
    );

    expect(html).not.toContain('step-image-iframe-note');
  });
});

describe('StepList (AC-03)', () => {
  test('head has numbered tick button and no "Step N of M" text', () => {
    const html = renderToStaticMarkup(
      <StepList
        steps={[
          { order: 1, action: 'click', instruction: 'First', image: { url: null, expired: false } },
          { order: 2, action: 'click', instruction: 'Second', image: { url: null, expired: false } },
          { order: 3, action: 'click', instruction: 'Third', image: { url: null, expired: false } },
        ]}
      />
    );

    for (const order of [1, 2, 3]) {
      expect(html).toContain(`aria-label="Mark step ${order} as done"`);
      expect(html).toContain('aria-pressed="false"');
      expect(html).toContain('class="step-circle"');
      expect(html).not.toContain(`Step ${order} of 3`);
    }
  });

  test('tick toggles aria-pressed and calls the hook', async () => {
    const orig = globalThis.localStorage;
    const origWindow = globalThis.window;
    const origDocument = globalThis.document;

    const win = new Window();
    const env = globalThis as unknown as {
      window: unknown;
      document: unknown;
      IS_REACT_ACT_ENVIRONMENT: boolean;
      localStorage: unknown;
    };
    env.window = win;
    env.document = win.document;
    env.IS_REACT_ACT_ENVIRONMENT = true;

    win.localStorage.setItem('od-done:doc-test', JSON.stringify([1]));
    env.localStorage = win.localStorage;

    const rootEl = win.document.createElement('div');
    win.document.body.appendChild(rootEl);
    const root = createRoot(rootEl as unknown as Element);

    try {
      await act(async () => {
        root.render(
          <StepList
            docId="doc-test"
            steps={[
              { order: 1, action: 'click', instruction: 'First', image: { url: null, expired: false } },
              { order: 2, action: 'click', instruction: 'Second', image: { url: null, expired: false } },
            ]}
          />
        );
      });

      const html = rootEl.innerHTML;
      // Step 1 is done
      expect(html).toContain('aria-label="Mark step 1 as done"');
      expect(html).toContain('aria-pressed="true"');
      expect(html).toContain('>✓</button>');

      // Step 2 is not done
      expect(html).toContain('aria-label="Mark step 2 as done"');
      expect(html).toContain('aria-pressed="false"');
      expect(html).toContain('>2</button>');

      await act(async () => {
        root.unmount();
      });
    } finally {
      globalThis.localStorage = orig;
      globalThis.window = origWindow;
      globalThis.document = origDocument;
    }
  });

  test('renders a server-side id="step-N" on each step', () => {
    const html = renderToStaticMarkup(
      <StepList
        steps={[
          { order: 1, action: 'click', instruction: 'First', image: { url: null, expired: false } },
          { order: 2, action: 'click', instruction: 'Second', image: { url: null, expired: false } },
        ]}
      />
    );

    expect(html).toContain('id="step-1"');
    expect(html).toContain('id="step-2"');
  });

  test('renders bold spans in instructions as <strong> with mark class', () => {
    const html = renderToStaticMarkup(
      <StepList
        steps={[
          {
            order: 1,
            action: 'click',
            instruction: 'Click **Add to cart**',
            image: { url: null, expired: false },
          },
        ]}
      />
    );

    expect(html).toContain('<strong class="mark">Add to cart</strong>');
    expect(html).not.toContain('**');
  });

  test('title heading', () => {
    const html = renderToStaticMarkup(
      <StepList
        steps={[
          {
            order: 1,
            action: 'click',
            instruction: 'Click login',
            title: 'Sign in to your account',
            image: { url: null, expired: false },
          },
        ]}
      />
    );

    expect(html).toContain('<h2');
    expect(html).toContain('Sign in to your account');
  });

  test('no heading when the step has no title', () => {
    const html = renderToStaticMarkup(
      <StepList
        steps={[
          { order: 1, action: 'click', instruction: 'Click login', image: { url: null, expired: false } },
        ]}
      />
    );

    expect(html).not.toContain('<h2');
  });

  test('figcaption renders the step alt when present', () => {
    const html = renderToStaticMarkup(
      <StepList
        steps={[
          {
            order: 1,
            action: 'click',
            instruction: 'Click login',
            alt: 'The login form',
            image: { url: 'https://example.test/img.png', expired: false, width: 100, height: 100 },
          },
        ]}
      />
    );

    expect(html).toContain('<figcaption>The login form</figcaption>');
  });

  test('no figcaption when the step has no alt', () => {
    const html = renderToStaticMarkup(
      <StepList
        steps={[
          {
            order: 1,
            action: 'click',
            instruction: 'Click login',
            image: { url: 'https://example.test/img.png', expired: false, width: 100, height: 100 },
          },
        ]}
      />
    );

    expect(html).not.toContain('<figcaption>');
  });
});

describe('InlineBold', () => {
  test('bold chip uses mark class', () => {
    const html = renderToStaticMarkup(<InlineBold text="Click **Add to cart**" />);

    expect(html).toContain('<strong class="mark">Add to cart</strong>');
    expect(html).not.toContain('**');
  });

  test('renders a code span as <code>', () => {
    const html = renderToStaticMarkup(<InlineBold text="save `Bun_(software).pdf`" />);

    expect(html).toContain('<code>Bun_(software).pdf</code>');
    expect(html).not.toContain('`');
  });
});
