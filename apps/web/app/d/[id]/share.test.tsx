import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ShareRow } from './share';

describe('ShareRow', () => {
  test('renders a Share button and the PDF button; the menu is closed by default', () => {
    const html = renderToStaticMarkup(<ShareRow url="https://example.test/d/abc" title="My Doc" />);

    expect(html).toContain('>Share<');
    expect(html).toContain('>PDF<');
    expect(html).toContain('aria-haspopup="true"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Copy link');
  });

  test('omits the native share menu item when navigator.share is unavailable (server render, before mount)', () => {
    const html = renderToStaticMarkup(<ShareRow url="https://example.test/d/abc" title="My Doc" />);

    expect(html).not.toContain('Share…');
  });
});
