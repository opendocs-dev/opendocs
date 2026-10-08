import { beforeEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { KeysManager, type ApiKey } from './keys-manager';

describe('KeysManager', () => {
  beforeEach(() => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ apiKeys: [] }), { status: 200 });
    }) as unknown as typeof fetch;
  });

  test('renders header with + New key primary button and Keys list as the first card (Finding 1 & 3)', () => {
    const html = renderToStaticMarkup(<KeysManager organizationId="org_123" />);
    // Header action (finding 1)
    expect(html).toContain('class="adm-pane-header"');
    expect(html).toContain('+ New key');
    expect(html).toContain('class="btn btn-primary"');

    // Create form is closed initially (sits behind + New key button)
    expect(html).not.toContain('<h3>Create an API key</h3>');

    // Keys card is the first card in the stack
    expect(html).toContain('<h3>Keys</h3>');
    // Connect your tool card in .split layout
    expect(html).toContain('<h3>Connect your tool</h3>');
  });

  test('renders Create an API key card with staging terms checkbox and Cancel button when opened (Finding 1)', () => {
    const html = renderToStaticMarkup(
      <KeysManager organizationId="org_123" initialShowCreate={true} />,
    );
    expect(html).toContain('<h3>Create an API key</h3>');
    expect(html).toContain('class="fld"');
    expect(html).toContain('class="btn btn-primary"');
    expect(html).toContain('Create key');
    expect(html).toContain('This key is for staging/demo data only. I agree to the Terms.');
    expect(html).toContain('Accept the terms above to create a key.');
    expect(html).toContain('Cancel');
  });

  test('renders empty state when initialKeys is empty', () => {
    const html = renderToStaticMarkup(<KeysManager organizationId="org_123" initialKeys={[]} />);
    expect(html).toContain('<h3>Keys</h3>');
    expect(html).toContain('No keys yet. Create one above to connect your agent.');
  });

  test('renders populated keys list with Name first (bold), Key second, Last used third, Revoke button (btn btn-danger)', () => {
    const sampleKeys: ApiKey[] = [
      {
        id: 'key_1',
        name: 'Laptop CLI',
        start: 'od_live_8f2a',
        createdAt: '2026-09-19T00:00:00Z',
        lastRequest: '2026-09-24T12:00:00Z',
        enabled: true,
      },
    ];

    const html = renderToStaticMarkup(
      <KeysManager organizationId="org_123" initialKeys={sampleKeys} />,
    );

    // Card heading
    expect(html).toContain('<h3>Keys</h3>');

    // Table header columns
    expect(html).toContain('<th>Name</th><th>Key</th><th>Last used</th><th');
    // Ensure "Created" column is not in the table
    expect(html).not.toContain('<th>Created</th>');

    // Row contents
    expect(html).toContain('<strong>Laptop CLI</strong>');
    expect(html).toContain('<code>od_live_8f2a···</code>');
    expect(html).toContain('Sep 24');
    expect(html).toContain('class="btn btn-danger"');
    expect(html).toContain('Revoke');
  });
});
