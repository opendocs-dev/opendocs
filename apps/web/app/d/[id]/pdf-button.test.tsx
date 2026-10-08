import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { PdfButton } from './pdf-button';

describe('PdfButton', () => {
  test('renders a PDF button', () => {
    const html = renderToStaticMarkup(<PdfButton />);

    expect(html).toContain('>PDF<');
    expect(html).toContain('<button');
    expect(html).toContain('btn-primary');
  });
});
