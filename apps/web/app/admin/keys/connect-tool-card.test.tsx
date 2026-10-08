import { beforeEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConnectToolCard } from './connect-tool-card';

// Well-known mutable global, not external/untrusted data: cast once to a named ref.
const globalScope = globalThis as { window?: unknown };

describe('ConnectToolCard', () => {
  // print.test.ts (lib/print.test.ts) sets globalThis.window without a .location and
  // never clears it; delete it here so this server render sees a real Node environment
  // regardless of test file run order.
  beforeEach(() => {
    delete globalScope.window;
  });

  test('defaults to the Claude Code tab selected, with its setup snippet shown', () => {
    const html = renderToStaticMarkup(<ConnectToolCard />);
    expect(html).toContain('class="seg"');
    expect(html).toContain('aria-selected="true" aria-pressed="true">Claude Code');
    expect(html).toContain('aria-selected="false" aria-pressed="false">Cursor');
    expect(html).toContain('aria-selected="false" aria-pressed="false">Other');
    expect(html).toContain('opendocs login --key &lt;your-key&gt;');
    expect(html).toContain('claude mcp add opendocs -- opendocs mcp');
    expect(html).not.toContain('OPENDOCS_API_URL');
  });

  test('shows the opendocs_compile example with a category and ask prompt', () => {
    const html = renderToStaticMarkup(<ConnectToolCard />);
    expect(html).toContain('opendocs_compile');
    expect(html).toContain('title: &quot;Create a WhatsApp template&quot;');
    expect(html).toContain('category: &quot;WhatsApp&quot;');
    expect(html).toContain('Record how to create a template and file it under WhatsApp.');
  });
});
