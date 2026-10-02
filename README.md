# OpenDocs

An AI agent documents every feature of your app, so nothing stays a hidden gem.

OpenDocs turns an agent's browser session into a structured, re-runnable **App Flow**:
screenshots plus steps, compiled into a guide your support team can share.

> **Status: alpha.** Published to npm under the `alpha` tag.

## What's here

This repo is the open-source client (MIT):

| Package | What it is |
|---|---|
| `packages/cli` | One binary per OS: the `opendocs` CLI and a local stdio MCP server |
| `packages/core` | The public API contract, limits, and redaction patterns shared with the OpenDocs service |

The hosted service (API and web) is closed source. The client only sends screenshots your
agent picks. Sensitive fields are covered in the page before capture, on by default.

## Install (alpha)

```sh
npx -y opendocs-cli@alpha login --key <your-key>
```

Claude Code:

```sh
claude mcp add opendocs -- npx -y opendocs-cli@alpha mcp
```

Cursor:

```json
{
  "mcpServers": {
    "opendocs": {
      "command": "npx",
      "args": ["-y", "opendocs-cli@alpha", "mcp"]
    }
  }
}
```

The alpha talks to `https://opendocs.tunnel.juniyadi.id` by default; set `OPENDOCS_API_URL` to override it.

### Recording on staging

If you record on a staging host but the app is public under a different domain, set `OPENDOCS_URL_MAP` so the
doc shows the public host instead:

```sh
OPENDOCS_URL_MAP=pfnapp.my.id=pfnapp.id
```

Format is comma-separated `from=to` pairs. Only the host (and port) is swapped; path, query and hash are kept.
Screenshots are not edited, so keep the host out of the captured viewport (e.g. no visible URL bar).

## Build from source

```sh
git clone https://github.com/opendocs-dev/opendocs && cd opendocs
bun install
bun run --cwd packages/cli build        # → packages/cli/dist/opendocs
OPENDOCS_API_URL=<site>/api/v1 ./packages/cli/dist/opendocs login --key <your-key>
```

## Security

See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
