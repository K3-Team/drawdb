import { loadTokens } from "../server/auth.js";
import { createMcpHttpServer } from "./httpServer.js";

/* global process */

// Entry point for the drawDB MCP service. It is a separate process from the
// collab server (server/index.js) and talks to it over HTTP + WebSocket as an
// authenticated drawDB user. Fail-closed on auth, mirroring the collab server.

function splitList(value) {
  return (value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// http(s)://host:port -> ws(s)://host:port
function toWsUrl(httpUrl) {
  const u = new URL(httpUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.origin;
}

export function createMcpApplication(env = process.env) {
  const collabHttpUrl = env.COLLAB_URL || "http://127.0.0.1:3000";
  const tokens = loadTokens();
  const authRequired =
    env.MCP_REQUIRE_AUTH === "1" ||
    env.MCP_REQUIRE_AUTH === "true" ||
    env.NODE_ENV === "production";
  if (tokens.size === 0 && authRequired) {
    throw new Error(
      "MCP auth required (MCP_REQUIRE_AUTH or NODE_ENV=production) but no COLLAB_TOKENS/COLLAB_TOKENS_FILE configured",
    );
  }
  if (tokens.size === 0) {
    console.warn(
      "[mcp] No tokens configured — MCP endpoint is UNAUTHENTICATED (dev only).",
    );
  }

  return createMcpHttpServer({
    tokens,
    collabHttpUrl,
    collabWsUrl: toWsUrl(collabHttpUrl),
    // Origin sent on the downstream collab WebSocket so it passes the collab
    // server's Origin allowlist (server/auth.js) in production.
    origin: env.COLLAB_ORIGIN || undefined,
    allowedHosts: splitList(env.MCP_ALLOWED_HOSTS),
    allowedOrigins: splitList(env.ALLOWED_ORIGINS),
  });
}

export function resolveMcpHost(env = process.env) {
  return env.MCP_HOST || "127.0.0.1";
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const port = Number.parseInt(process.env.MCP_PORT || "3001", 10);
  const host = resolveMcpHost();

  let application;
  try {
    application = createMcpApplication();
  } catch (error) {
    console.error("[mcp] Failed to start:", error.message);
    process.exit(1);
  }

  process.on("uncaughtException", (err) =>
    console.error("[mcp] uncaughtException:", err),
  );
  process.on("unhandledRejection", (err) =>
    console.error("[mcp] unhandledRejection:", err),
  );

  application.httpServer.on("error", (error) => {
    console.error("[mcp] Server error:", error.message);
    if (!application.httpServer.listening) process.exit(1);
  });

  application.httpServer.listen(port, host, () => {
    console.log(`drawDB MCP listening on http://${host}:${port}/mcp`);
  });
}
