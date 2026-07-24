# drawDB MCP service

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets AI
assistants create and edit drawDB diagrams. It is a **separate process** from
the collaboration server (`server/`) and talks to it over HTTP + WebSocket **as
an authenticated drawDB user**, so AI edits persist in SQLite and broadcast live
to every connected browser — no browser needs to be open.

## How it works

```
AI client ──MCP (HTTP, Bearer token)──▶ mcp/index.js ──WS collab participant──▶ server/ ──broadcast──▶ browsers
```

- Every mutating tool is a pure `(document, args) => document` transform
  (`mcp/mutators/`). Its result is persisted as one `snapshot.replace` operation
  with optimistic-concurrency retry (`mcp/collabClient.js`) — the same hardened
  write path the browser uses. No new collab message types.
- One MCP session holds **one open diagram**. Start with `create_diagram` or
  `open_diagram`, then edit; the entity tools act on the open diagram.
- Auth is **fail-closed**: the Bearer token must be in the collab token map
  (`COLLAB_TOKENS` / `COLLAB_TOKENS_FILE`). That token both authorises MCP and
  identifies the collaborator the edits are attributed to (it appears in
  presence like any human).

## Running it

**NixOS** (recommended) — enable alongside the collab service; they share the
token map:

```nix
services.drawdb = {
  enable = true;
  allowedOrigins = [ "https://drawdb.example.com" ];
  tokensFile = "/run/secrets/drawdb-tokens";
  mcp.enable = true;      # adds a hardened drawdb-mcp unit on 127.0.0.1:3001
};
```

**Standalone** — point it at a running collab server:

```bash
COLLAB_URL=http://127.0.0.1:3000 \
COLLAB_TOKENS_FILE=/path/to/tokens.json \
MCP_PORT=3001 \
npm run start:mcp
```

## Exposing it (local vs remote)

The service is meant to be driven **remotely** — an AI assistant on your laptop
manipulating a diagram on a server elsewhere. Do that the same way the collab
server is served: publish it **through your reverse proxy over TLS**, and let
the token be the gate. The default loopback bind is deliberate — the proxy (not
the raw Node process) faces the internet and terminates TLS, and the Bearer
token must travel over HTTPS.

- **Local** (assistant and server on the same host): connect straight to
  `http://127.0.0.1:3001/mcp`.
- **Remote**: reverse-proxy `https://drawdb.example.com/mcp` → `127.0.0.1:3001`,
  and connect to the `https://` URL. Set `mcp.allowedHosts`
  (`MCP_ALLOWED_HOSTS`) to the public hostname for Host-header pinning
  (DNS-rebinding defence-in-depth). Only bind `mcp.host` to a routable address
  if you terminate TLS somewhere else — never expose the plaintext port with a
  Bearer token on the open internet.

The MCP token has the same power as any collab token (full diagram
read/write/delete), so treat it exactly like one: keep it secret, use per-user
tokens, and serve only over TLS.

## Connecting an assistant

The MCP endpoint is `http(s)://<host>/mcp`. Authenticate with one of the drawDB
tokens.

Claude Code / Claude Desktop:

```bash
claude mcp add --transport http drawdb http://127.0.0.1:3001/mcp \
  --header "Authorization: Bearer <your-drawdb-token>"
```

Generic MCP client config:

```json
{
  "mcpServers": {
    "drawdb": {
      "transport": "http",
      "url": "http://127.0.0.1:3001/mcp",
      "headers": { "Authorization": "Bearer <your-drawdb-token>" }
    }
  }
}
```

## Usage guide

A session is always: **pick a diagram → edit → (optionally) export.**

1. **Find or create a diagram.**
   - `list_diagrams` → the diagrams on the server.
   - `open_diagram { "diagramId": "<id>" }` → work on an existing one.
   - `create_diagram { "name": "Blog", "database": "postgresql" }` → new one,
     opened automatically. Databases: `postgresql`, `mysql`, `mariadb`,
     `sqlite`, `transactsql` (MSSQL), `oraclesql`, `generic`.

2. **Build the schema.** Two styles, mix freely:
   - **Bulk, from DBML** (fastest for whole schemas):
     `import_dbml { "dbml": "Table users {\n  id integer [pk, increment]\n  email varchar [unique, not null]\n}" }`
   - **Fine-grained**:
     - `add_table { "name": "users" }` → returns `{ id, fieldIds }`. Without
       `fields`, a primary-key `id` field is created.
     - `add_field { "tableId": "<id>", "field": { "name": "email", "type": "VARCHAR", "size": 255, "notNull": true } }`
     - `add_relationship { "startTableId": "<posts>", "startFieldId": "<author_id>", "endTableId": "<users>", "endFieldId": "<id>", "cardinality": "many_to_one" }`
     - `update_table` / `update_field` / `delete_table` … (delete_table also
       drops relationships that referenced it).
   - Annotate: `add_area`, `add_note`. PostgreSQL-only: `add_enum`, `add_type`.

3. **Inspect.** `get_diagram` (full document) or `get_table { "tableName": "users" }`.

4. **Export.**
   - `export_dbml` → DBML text (round-trips with `import_dbml`).
   - `export_sql` → DDL for the diagram's engine (throws for `generic` — set a
     concrete database first).

Edits are versioned and broadcast: if a human is editing the same diagram, a
conflicting write is re-applied onto the latest state automatically, so your
change and theirs both land.

## Configuration (env)

| Variable | Default | Purpose |
| --- | --- | --- |
| `MCP_HOST` / `MCP_PORT` | `127.0.0.1` / `3001` | Listener for the MCP endpoint (`/mcp`). |
| `COLLAB_URL` | `http://127.0.0.1:3000` | The collab server to drive. |
| `COLLAB_TOKENS` / `COLLAB_TOKENS_FILE` | — | Token map shared with the collab server. |
| `COLLAB_ORIGIN` | — | `Origin` sent on the downstream collab WebSocket (must be in the collab `ALLOWED_ORIGINS`). |
| `ALLOWED_ORIGINS` | — | When set, pins allowed `Origin` headers (DNS-rebinding protection). |
| `MCP_ALLOWED_HOSTS` | — | When set, pins allowed `Host` headers — recommended for a proxy-published endpoint. |
| `MCP_REQUIRE_AUTH` | — | `1` (or `NODE_ENV=production`) refuses to start without tokens. |

## Notes

- The SQL exporters are the client's own dialect generators, bundled for Node
  by `scripts/build-mcp-vendor.mjs` into `mcp/vendor/exportSQL.js` (a build
  artifact; regenerate with `npm run build:mcp-vendor`). This keeps the MCP
  service's SQL identical to the browser's, including the `sqlSafety` escaping.
