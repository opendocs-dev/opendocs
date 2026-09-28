# OpenDocs

An AI agent documents every feature of your app, so nothing stays a hidden gem.

OpenDocs turns an agent's browser session into a structured, re-runnable **App Flow**:
screenshots plus steps, compiled into a guide your support team can share.

> **Status: pre-alpha.** Nothing is published yet.

## What's here

This repo is the open-source client (MIT):

| Package | What it is |
|---|---|
| `packages/cli` | One binary per OS: the `opendocs` CLI and a local stdio MCP server |
| `packages/core` | The public API contract, limits, and redaction patterns shared with the OpenDocs service |

The hosted service (API and web) is closed source. The client only sends screenshots your
agent picks. Sensitive fields are covered in the page before capture, on by default.

## Planned usage

```sh
npx @opendocs/cli mcp
```

## Security

See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
