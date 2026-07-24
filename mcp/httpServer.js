import http from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createSession } from "./session.js";
import { registerTools } from "./tools.js";

const SERVER_INFO = { name: "drawdb-mcp", version: "0.1.0" };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      // Bounded to keep a hostile client from exhausting memory.
      if (raw.length > 4 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

const json = (res, status, obj) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
};

const isInitialize = (body) =>
  (Array.isArray(body) ? body : [body]).some((m) => m?.method === "initialize");

// Builds an http.Server that speaks MCP Streamable HTTP with per-session state.
// Auth is fail-closed Bearer against the token map (like server/auth.js): the
// presented token identifies the drawDB user and is threaded into that
// session's downstream collab connections.
export function createMcpHttpServer({
  tokens,
  collabHttpUrl,
  collabWsUrl,
  origin,
  allowedHosts = [],
  allowedOrigins = [],
  path = "/mcp",
}) {
  const sessions = new Map(); // sessionId -> { transport, server, session }
  const dnsProtection = allowedHosts.length > 0 || allowedOrigins.length > 0;

  const authenticate = (req) => {
    if (!tokens || tokens.size === 0) return { token: null, identity: null }; // dev-open
    const header = req.headers["authorization"] || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const identity = tokens.get(token);
    return identity ? { token, identity } : null;
  };

  const disposeSession = (sessionId) => {
    const entry = sessions.get(sessionId);
    if (!entry) return;
    entry.session.close();
    sessions.delete(sessionId);
  };

  const httpServer = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname !== path) {
        json(res, 404, { error: "Not found" });
        return;
      }

      const auth = authenticate(req);
      if (auth === null) {
        json(res, 401, { error: "Unauthorized" });
        return;
      }

      const sessionId = req.headers["mcp-session-id"];
      const existing = sessionId ? sessions.get(sessionId) : undefined;

      if (req.method === "POST") {
        const body = await readBody(req);
        if (existing) {
          await existing.transport.handleRequest(req, res, body);
          return;
        }
        if (!isInitialize(body)) {
          json(res, 400, {
            error: "No valid session id; an initialize request is required",
          });
          return;
        }
        // New session: bind the authenticated identity/token for its lifetime.
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          // Our tools are unary request/response; plain JSON replies (rather
          // than an SSE stream) keep the endpoint usable by simple HTTP clients.
          enableJsonResponse: true,
          enableDnsRebindingProtection: dnsProtection,
          allowedHosts,
          allowedOrigins,
          onsessionclosed: disposeSession,
        });
        transport.onclose = () => {
          if (transport.sessionId) disposeSession(transport.sessionId);
        };
        const session = createSession({
          collabHttpUrl,
          collabWsUrl,
          token: auth.token,
          origin,
          identity: auth.identity,
        });
        const server = new McpServer(SERVER_INFO);
        registerTools(server, session);
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
        if (transport.sessionId)
          sessions.set(transport.sessionId, { transport, server, session });
        return;
      }

      // GET (SSE stream) and DELETE (terminate) require an established session.
      if (!existing) {
        json(res, 400, { error: "Unknown or missing session id" });
        return;
      }
      await existing.transport.handleRequest(req, res);
    } catch (error) {
      console.error("[mcp] request error:", error.message);
      if (!res.headersSent) json(res, 400, { error: "Bad request" });
    }
  });

  httpServer.on("close", () => {
    for (const id of [...sessions.keys()]) disposeSession(id);
  });

  return { httpServer, sessions };
}
