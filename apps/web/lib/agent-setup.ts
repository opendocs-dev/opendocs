export type AgentSetup = {
  claudeCode: string;
  cursor: string;
  other: string;
  login: string;
};

/**
 * Copy-paste snippets that connect a coding agent to this workspace.
 * Shortened to the mock version: clean CLI binary command without raw tunnel URLs.
 * `key` is null before a key exists, so the snippets stay readable with a
 * placeholder instead of an empty flag.
 */
export function agentSetup(key: string | null, _origin?: string): AgentSetup {
  const keyValue = key ?? '<your-key>';
  const login = `opendocs login --key ${keyValue}`;
  const claudeMcpAdd = 'claude mcp add opendocs -- opendocs mcp';

  const cursorConfig = {
    mcpServers: {
      opendocs: {
        command: 'opendocs',
        args: ['mcp'],
      },
    },
  };

  const other = `${login}\nopendocs mcp`;

  return {
    login,
    claudeCode: `${login}\n${claudeMcpAdd}`,
    cursor: `${login}\n\n${JSON.stringify(cursorConfig, null, 2)}`,
    other,
  };
}
