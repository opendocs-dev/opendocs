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

The service (API and web) lives in `apps/api` and `apps/web` and can be self-hosted (see below). The client only sends screenshots your
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

## Self-host

One `docker compose` stack: Postgres, S3 storage (bundled MinIO by default), the api and the web app.
Everything is served from one port (docs at `/`, dashboard at `/admin`, api at `/api`).

Requirements: Docker with Compose v2, and a GitHub account to create an OAuth app. Sign-in is GitHub
only; without `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` nobody can log in.

1. Copy the config and edit it. `.env.example` documents every variable.

   ```sh
   git clone https://github.com/opendocs-dev/opendocs && cd opendocs
   cp .env.example .env
   ```

   Required: `PUBLIC_URL` (the URL users open, no path), `BETTER_AUTH_SECRET` (32+ characters,
   `openssl rand -hex 32`), `ADMIN_EMAILS` (comma list), `POSTGRES_PASSWORD`, the `S3_*` keys
   (`S3_SECRET_ACCESS_KEY` is also the MinIO password), and the GitHub pair below.
   `PUBLIC_URL` is baked into the web image, so rebuild (`docker compose up -d --build`) after changing it.

2. Create a GitHub OAuth app (GitHub, Settings, Developer settings, OAuth Apps). Set the callback URL to
   `${PUBLIC_URL}/api/auth/callback/github` and put the client id and secret in `GITHUB_CLIENT_ID` and
   `GITHUB_CLIENT_SECRET`.

3. Start it.

   ```sh
   docker compose up -d
   ```

   The api validates its config on start and exits with a list of every bad variable
   (`docker compose logs api`), then applies database migrations.

4. Open `PUBLIC_URL` and sign in with GitHub. The first user to sign in becomes the owner; put your
   email in `ADMIN_EMAILS` so it is an admin. Create an API key under `/admin/keys`.

5. Point the CLI at your instance:

   ```sh
   export OPENDOCS_API_URL=<PUBLIC_URL>/api/v1
   npx -y opendocs-cli@alpha login --key <your-key>
   ```

TLS: the stack publishes plain HTTP on `WEB_PORT` (default 3000). Put a reverse proxy with TLS in front
and set `PUBLIC_URL` to its https URL.

External S3 (Cloudflare R2, Backblaze B2, AWS S3): set `COMPOSE_PROFILES=` (empty) in `.env` so MinIO is not
started, and set `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`
(R2 uses `auto`) and `S3_FORCE_PATH_STYLE` (`false` for AWS and R2). Create the bucket yourself.
Set `ASSET_BASE_URL` to serve images from a CDN or public bucket instead of through the api.

Upgrade: `git pull && docker compose up -d --build`. Migrations run on api start; data lives in the
`pgdata` and `miniodata` volumes. The dev-only Postgres for tests is `docker-compose.dev.yml`.

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
