<br/>
<br/>

<div align="center">
    <img width="64" alt="drawDB logo" src="./src/assets/icon-dark.png">
    <h1>drawDB</h1>
</div>

<h3 align="center">Free, simple, and intuitive database schema editor and SQL generator.</h3>

<div align="center" style="margin-bottom:12px;">
    <a href="https://drawdb.app/" style="display: flex; align-items: center;">
        <img src="https://img.shields.io/badge/Start%20building-grey" alt="drawDB"/>
    </a>
</div>

<h3 align="center"><img width="700" style="border-radius:5px;" alt="drawDB screenshot demo" src="drawdb.png"></h3>

DrawDB is a robust and user-friendly database entity relationship diagram (ERD) editor right in your browser. Build diagrams with a few clicks, export and import SQL scripts, generate migrations, customize your editor, and more without creating an account. See the full set of features on [here](https://drawdb.app/).

## Getting Started

### Local Development

```bash
git clone https://github.com/drawdb-io/drawdb
cd drawdb
npm install
npm run dev
```

### Build

```bash
git clone https://github.com/drawdb-io/drawdb
cd drawdb
npm install
npm run build
```

### Docker Build

```bash
docker build -t drawdb .
docker run -p 3000:80 drawdb
```

If you want to enable sharing, set up the [server](https://github.com/drawdb-io/drawdb-server) and environment variables according to `.env.sample`. This is optional unless you need to share files.

## Collaboration server

This fork bundles a live-collaboration server (Express + `ws` + SQLite) that serves the built SPA, the `/api/diagrams` REST API, and the `/ws/diagrams/:id` WebSocket from a single Node process — there is no separate backend to stand up.

### Running it

- **Local dev**: `npm run dev` runs the Vite dev server and the collab server concurrently (`npm:dev:server` + `npm:dev:client`), so the SPA is served by Vite while the API/WebSocket run against `node --watch server/index.js`.
- **Production (bare Node)**: `npm run build` then `npm start` (`node server/index.js`) — the server serves the built `dist/` alongside the API and WebSocket on `PORT` (default `3000`).
- **Docker / Compose**: `docker build -t drawdb .` / `docker run -p 3000:80 drawdb` for a one-off image, or `docker compose up` using the provided `compose.yml`, which builds the image, publishes `3000:3000`, and persists the SQLite file on a named volume (`drawdb-data:/data`, with `DATABASE_PATH=/data/drawdb.sqlite`).

#### Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT` | Port the server listens on (default `3000`). |
| `DATABASE_PATH` | Path to the collaboration server's own SQLite file (default `./data/drawdb.sqlite`, `/data/drawdb.sqlite` in the Docker image). This store holds **live diagrams and their operation log** — it is separate from, and unrelated to, any exported SQL/Postgres schema files the app generates. |
| `COLLAB_TOKENS` | Inline JSON object mapping access tokens to user identities. |
| `COLLAB_TOKENS_FILE` | Path to a JSON file with the same shape as `COLLAB_TOKENS`, read at boot. Use one or the other. |
| `COLLAB_REQUIRE_AUTH` | Set to `1` or `true` to make the server **refuse to start** if no tokens are configured. `NODE_ENV=production` has the same effect. |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed `Origin` values for the WebSocket upgrade. **Required** once auth is enforced — the server also refuses to start without it in that case. |

Tokens are assigned manually, one per user — there is no self-service signup. Each entry's shape is:

```json
{
  "<token>": {
    "userId": "...",
    "displayName": "...",
    "color": "#rrggbb"
  }
}
```

For example:

```bash
COLLAB_TOKENS='{"9f1c2e...": {"userId": "alice", "displayName": "Alice", "color": "#2563eb"}}'
```

The server derives each user's identity (`userId`, `displayName`, `color`) purely from which token they present — a client cannot supply or override its own identity once authenticated, so one user cannot impersonate another.

**Production deployments must set `COLLAB_REQUIRE_AUTH=1` (or `NODE_ENV=production`)** so the server never silently boots unauthenticated. With no tokens configured and auth not enforced, the API is open and only logs a warning — fine for local dev, not for anything internet-facing. For this fork's VPS deployment, set `ALLOWED_ORIGINS` to the drawdb subdomain's origin, e.g.:

```bash
ALLOWED_ORIGINS=https://drawdb.example.com
```

### Security notes

- **TLS is assumed to be terminated by the reverse proxy.** The Node process itself speaks plain HTTP and plain `ws://` — only ever expose it behind an HTTPS/WSS-terminating proxy (nginx, Caddy, etc.), never directly on the internet.

- **CRITICAL — the collaboration token travels in the WebSocket URL's query string** (`/ws/diagrams/:id?token=...`), because the WebSocket handshake cannot carry a custom `Authorization` header from the browser. Reverse proxies and load balancers log the full request line — including the query string — by default, which means an unmodified proxy config will write every user's token straight into the access logs. **Operators must disable access logging for the `/ws/` location (or strip the query string from the log format).** Example nginx config:

  ```nginx
  location /ws/ {
      proxy_pass http://127.0.0.1:3000;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_set_header Host $host;

      # Do not log tokens: the ?token=... query string must never hit the
      # access log for this location.
      access_log off;
  }
  ```

  If you need access logs for `/ws/`, use a `log_format` that omits `$request` and `$query_string` entirely rather than turning logging off outright.

  This query-string transport is a known interim tradeoff, not a long-term design choice. The recommended future hardening is to move the token into the `Sec-WebSocket-Protocol` header (sent during the WS handshake without landing in the URL), which would remove this operator burden entirely.

- **How the browser gets a token**: when the app receives a `401` from the REST API, it prompts the user for an access token and stores it in `localStorage["drawdb-collab-token"]`. From then on it's sent as `Authorization: Bearer <token>` on REST requests and as `?token=...` on the WebSocket URL, per the point above.

### Known limitations / deferred hardening

These are intentionally **not** implemented yet — know the boundaries before relying on this in production:

- **No rate limiting, per-connection/per-diagram caps, or storage quotas.** Any authenticated (trusted) user can create unlimited diagrams, spam operations, or hold many table locks at once. This is mitigated by the fact that every caller must already hold a manually-issued token, but it is not enforced server-side.
- **No per-diagram access control.** Any valid token holder can read, edit, or **delete any diagram** — there is no ownership or ACL model. Treat every token as equally privileged across the whole diagram set.
- **Token revocation requires a server restart.** Tokens are loaded once from `COLLAB_TOKENS`/`COLLAB_TOKENS_FILE` at boot; removing or rotating an entry has no effect until the process restarts.
- **Pre-hardening documents are still relayed as-is.** A malformed diagram document persisted by a server build from before document validation was added would still be read and rebroadcast if it exists in the database; fresh deployments never produce such documents in the first place.

## Contributing

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute to this project.
