# drawDB MCP service

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets AI
assistants create and edit drawDB diagrams. It is a **separate process** from
the collaboration server (`server/`) and talks to it over HTTP + WebSocket **as
an authenticated drawDB user**, so AI edits persist in SQLite and broadcast live
to every connected browser — no browser needs to be open.

## Architecture

```
AI client ──MCP (HTTP, Bearer token)──▶ mcp/index.js ──WS collab participant──▶ server/ ──broadcast──▶ browsers
```

- Fine-grained tools (`add_table`, `add_field`, `add_relationship`, `import_dbml`,
  `export_dbml`, …) are pure `(document, args) => document` transforms
  (`mcp/mutators/`). Each result is persisted as one `snapshot.replace`
  operation with optimistic-concurrency retry (`mcp/collabClient.js`) — the same
  hardened write path the browser uses. No new collab message types.
- One MCP session holds one open diagram. Start with `create_diagram` or
  `open_diagram`, then edit.
- Auth is fail-closed: the Bearer token must be in the collab token map
  (`COLLAB_TOKENS` / `COLLAB_TOKENS_FILE`). That token both authorises MCP and
  identifies the collaborator the edits are attributed to.

## Configuration (env)

| Variable | Default | Purpose |
| --- | --- | --- |
| `MCP_HOST` / `MCP_PORT` | `127.0.0.1` / `3001` | Listener for the MCP endpoint (`/mcp`). |
| `COLLAB_URL` | `http://127.0.0.1:3000` | The collab server to drive. |
| `COLLAB_TOKENS` / `COLLAB_TOKENS_FILE` | — | Token map shared with the collab server. |
| `COLLAB_ORIGIN` | — | `Origin` sent on the downstream collab WebSocket (must be in the collab `ALLOWED_ORIGINS`). |
| `ALLOWED_ORIGINS` | — | When set, enables DNS-rebinding protection on the MCP endpoint. |
| `MCP_REQUIRE_AUTH` | — | `1` (or `NODE_ENV=production`) refuses to start without tokens. |

Run standalone: `npm run start:mcp`. On NixOS use `services.drawdb.mcp.enable`.

## Connecting an assistant

```
claude mcp add --transport http drawdb http://127.0.0.1:3001/mcp \
  --header "Authorization: Bearer <your-drawdb-token>"
```

## Not yet implemented

- **SQL export** (`export_sql`). The client's per-dialect exporters under `src/`
  are Vite-bundler code (extensionless/asset imports) that plain Node can't
  load; reusing them needs a bundling step. `export_dbml` is available and
  round-trips. Humans can still export SQL from the browser UI.
