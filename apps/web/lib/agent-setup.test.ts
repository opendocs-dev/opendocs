import { describe, expect, test } from 'bun:test';

import { agentSetup } from './agent-setup';

const ORIGIN = 'https://opendocs.example';

describe('agentSetup', () => {
  test('fills the key into Claude Code and Cursor snippets (shortened to mock version)', () => {
    const setup = agentSetup('od_live_secret', ORIGIN);

    expect(setup.login).toBe('opendocs login --key od_live_secret');
    expect(setup.claudeCode).toBe(
      'opendocs login --key od_live_secret\nclaude mcp add opendocs -- opendocs mcp',
    );
    expect(setup.cursor).toContain('opendocs login --key od_live_secret');
    expect(setup.cursor).toContain('"command": "opendocs"');
    expect(setup.cursor).not.toContain('OPENDOCS_API_URL');
    expect(setup.other).toBe('opendocs login --key od_live_secret\nopendocs mcp');
  });

  test('uses a placeholder when the key is null', () => {
    const setup = agentSetup(null, ORIGIN);

    expect(setup.login).toBe('opendocs login --key <your-key>');
    expect(setup.claudeCode).toBe(
      'opendocs login --key <your-key>\nclaude mcp add opendocs -- opendocs mcp',
    );
    expect(setup.cursor).toContain('--key <your-key>');
    expect(setup.other).toBe('opendocs login --key <your-key>\nopendocs mcp');
  });

  test('produces valid JSON for Cursor without tunnel wrappers', () => {
    const setup = agentSetup('od_live_secret', ORIGIN);
    const json = setup.cursor.slice(setup.cursor.indexOf('{'));

    expect(JSON.parse(json)).toEqual({
      mcpServers: {
        opendocs: {
          command: 'opendocs',
          args: ['mcp'],
        },
      },
    });
  });
});
