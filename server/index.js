import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { loadTokens, requireAuth, loadAllowedOrigins } from "./auth.js";
import { createDiagramStore, openDatabase } from "./database.js";
import { DIAGRAM_ID_PATTERN, isPlainObject } from "./protocol.js";
import { isDiagramDocument } from "./validateDocument.js";
import { attachCollaborationServer } from "./websocket.js";

/* global process */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_DOCUMENT_BYTES = "2mb";

export function createApplication({ databasePath, staticPath } = {}) {
  const database = openDatabase(databasePath);
  const store = createDiagramStore(database);
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: MAX_DOCUMENT_BYTES }));

  const tokens = loadTokens();
  const authRequired =
    process.env.COLLAB_REQUIRE_AUTH === "1" ||
    process.env.COLLAB_REQUIRE_AUTH === "true" ||
    process.env.NODE_ENV === "production";
  if (tokens.size === 0) {
    if (authRequired) {
      console.error(
        "[collab] Refusing to start: auth is required (COLLAB_REQUIRE_AUTH or NODE_ENV=production) but no valid COLLAB_TOKENS/COLLAB_TOKENS_FILE configured.",
      );
      throw new Error("Collaboration auth required but no tokens configured");
    }
    console.warn(
      "[collab] No COLLAB_TOKENS configured — API is UNAUTHENTICATED (dev only).",
    );
  }
  if (authRequired && loadAllowedOrigins() === null) {
    console.error(
      "[collab] Refusing to start: auth is required but no ALLOWED_ORIGINS allowlist configured.",
    );
    throw new Error("ALLOWED_ORIGINS required when auth is enforced");
  }
  app.use("/api", requireAuth(tokens));

  const validId = (req, res, next) => {
    if (!DIAGRAM_ID_PATTERN.test(req.params.id || "")) {
      res.status(400).json({ error: "Invalid diagram ID" });
      return;
    }
    next();
  };
  const validPayload = (body) =>
    isPlainObject(body) &&
    typeof body.name === "string" &&
    body.name.trim().length > 0 &&
    body.name.length <= 200 &&
    isDiagramDocument(body.document);

  app.get("/api/diagrams", (_req, res) => res.json({ diagrams: store.list() }));
  app.post("/api/diagrams", (req, res, next) => {
    try {
      if (!validPayload(req.body)) {
        res
          .status(400)
          .json({ error: "A valid name and document are required" });
        return;
      }
      const requestedId = req.body.id;
      const id = requestedId ?? crypto.randomUUID();
      if (!DIAGRAM_ID_PATTERN.test(id)) {
        res.status(400).json({ error: "Invalid diagram ID" });
        return;
      }
      if (store.get(id)) {
        res.status(409).json({ error: "Diagram already exists" });
        return;
      }
      res.status(201).json(store.create({ id, ...req.body }));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/diagrams/:id", validId, (req, res) => {
    const diagram = store.get(req.params.id);
    if (!diagram) res.status(404).json({ error: "Diagram not found" });
    else res.json(diagram);
  });
  app.put("/api/diagrams/:id", validId, (req, res) => {
    if (!validPayload(req.body) || !Number.isInteger(req.body.baseVersion)) {
      res
        .status(400)
        .json({
          error: "A valid name, document, and baseVersion are required",
        });
      return;
    }
    const result = store.updateSnapshot({ id: req.params.id, ...req.body });
    if (result.status === "not_found")
      res.status(404).json({ error: "Diagram not found" });
    else if (result.status === "conflict") {
      res
        .status(409)
        .json({ error: "Version conflict", diagram: result.diagram });
    } else res.json(result.diagram);
  });
  app.delete("/api/diagrams/:id", validId, (req, res) => {
    if (!store.delete(req.params.id))
      res.status(404).json({ error: "Diagram not found" });
    else res.status(204).end();
  });

  const assets = staticPath || path.resolve(__dirname, "../dist");
  if (fs.existsSync(assets)) {
    app.use(express.static(assets));
    app.get("*splat", (_req, res) =>
      res.sendFile(path.join(assets, "index.html")),
    );
  }
  app.use((error, _req, res, next) => {
    void next;
    console.error("Request failed:", error.message);
    if (error?.type === "entity.too.large") {
      res.status(413).json({ error: "Request body is too large" });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  const server = http.createServer(app);
  const websocket = attachCollaborationServer(server, store, {
    tokens,
    allowedOrigins: loadAllowedOrigins(),
  });
  return { app, server, websocket, database, store, tokens };
}

export function resolveHost(env = process.env) {
  return env.HOST || "0.0.0.0";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number.parseInt(process.env.PORT || "3000", 10);

  // Startup failures must reach the service manager. Registering an
  // uncaughtException handler suppresses node's default exit-on-throw, so the
  // handlers below are installed only once startup has succeeded — otherwise a
  // fail-closed refusal would exit 0 and systemd would read it as success.
  let application;
  try {
    application = createApplication();
  } catch (error) {
    console.error("[collab] Failed to start:", error.message);
    process.exit(1);
  }

  // Defense-in-depth for the *running* server (not installed when tests import
  // createApplication). The per-message try/catch in websocket.js is the real
  // fix; these are last-resort logging so an unforeseen throw elsewhere logs
  // instead of silently killing the shared collaboration process.
  process.on("uncaughtException", (err) => {
    console.error("[collab] uncaughtException:", err);
  });
  process.on("unhandledRejection", (err) => {
    console.error("[collab] unhandledRejection:", err);
  });

  // Bind failures (EADDRINUSE, EACCES, or EADDRNOTAVAIL when the configured
  // HOST interface is not up yet) arrive as an 'error' event rather than a
  // throw, so the uncaughtException handler above would otherwise swallow them
  // and exit 0. Registered before listen() — the event can fire immediately.
  //
  // Guarded on `listening` deliberately: it is false for every bind failure,
  // and true once the server is up. A post-listen 'error' is an accept failure
  // (EMFILE/ENFILE, i.e. fd exhaustion), which is usually transient — logging
  // and staying up beats dropping every live collaboration session.
  application.server.on("error", (error) => {
    console.error("[collab] Server error:", error.message);
    if (!application.server.listening) process.exit(1);
  });

  const host = resolveHost();
  application.server.listen(port, host, () => {
    console.log(`drawDB listening on http://${host}:${port}`);
  });
}
