import crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import {
  CLIENT_ID_PATTERN,
  DIAGRAM_ID_PATTERN,
  isValidEntityId,
  isPlainObject,
  isValidOperationPreview,
  isValidParticipant,
  MESSAGE_TYPES,
} from "./protocol.js";
import { createTableLockManager } from "./tableLocks.js";
import { authenticateToken, isOriginAllowed } from "./auth.js";
import { isDiagramDocument } from "./validateDocument.js";

const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;

// Mirrors the REST `validPayload` name rule (server/index.js) so WS and REST
// agree on what a valid diagram name is. Also caps length, closing the
// WS-name-length gap. A non-string here would additionally crash better-sqlite3
// on bind, so this MUST run before any store write.
function isValidDiagramName(name) {
  return (
    typeof name === "string" && name.trim().length > 0 && name.length <= 200
  );
}

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

export function attachCollaborationServer(
  server,
  store,
  { tokens, allowedOrigins } = {},
) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
  });
  const rooms = new Map();
  const tableLocks = createTableLockManager();

  const broadcast = (diagramId, message, except = null) => {
    for (const client of rooms.get(diagramId) || []) {
      if (client !== except) send(client, message);
    }
  };

  const broadcastPresence = (diagramId) => {
    const participants = [...(rooms.get(diagramId) || [])]
      .map((client) => client.participant)
      .filter(Boolean);
    broadcast(diagramId, {
      type: MESSAGE_TYPES.PRESENCE,
      diagramId,
      participants,
    });
  };

  const broadcastTableLocks = (diagramId) => {
    broadcast(diagramId, {
      type: MESSAGE_TYPES.TABLE_LOCK_STATE,
      diagramId,
      locks: tableLocks.list(diagramId),
    });
  };

  server.on("upgrade", (request, socket, head) => {
    // The whole upgrade path runs PRE-AUTH and outside the message-handler
    // try/catch. `new URL(request.url, ...)` throws on malformed request
    // targets (e.g. `/\`, `http://[bad`) that Node's HTTP parser passes through
    // verbatim. An unhandled throw here would crash the embedded server (and in
    // the CLI leak the socket). Isolate it: on ANY throw, 400 + destroy the
    // socket so no connection is left hung.
    try {
      const url = new URL(request.url, "http://localhost");
      const match = url.pathname.match(/^\/ws\/diagrams\/([^/]+)$/);
      const diagramId = match?.[1];
      // URL shape validation only — this leaks nothing about which diagrams
      // exist (a malformed path is rejected regardless of auth).
      if (!diagramId || !DIAGRAM_ID_PATTERN.test(diagramId)) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }
      // Origin allowlist first, then token auth — both must pass before we
      // reveal anything else about the target diagram.
      if (!isOriginAllowed(allowedOrigins, request.headers.origin)) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      let identity = null;
      if (tokens && tokens.size > 0) {
        // Token is carried in the ?token= query param (approved v1 transport);
        // operators MUST keep it out of proxy access logs.
        const token = url.searchParams.get("token");
        identity = authenticateToken(tokens, token);
        if (!identity) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
      }
      // Existence check runs AFTER auth so unauthenticated/wrong-origin callers
      // cannot probe which diagram ids exist.
      if (!store.get(diagramId)) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.diagramId = diagramId;
        ws.identity = identity;
        wss.emit("connection", ws, request);
      });
    } catch (error) {
      console.error("[collab] Error during WebSocket upgrade:", error);
      try {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      } catch {
        /* socket may already be gone */
      }
      socket.destroy();
    }
  });

  wss.on("connection", (socket) => {
    const diagramId = socket.diagramId;
    if (!rooms.has(diagramId)) rooms.set(diagramId, new Set());
    rooms.get(diagramId).add(socket);
    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("message", (raw) => {
      // A single message must never be able to take down the shared process:
      // one Node process serves every collaborator, so any unhandled throw in
      // here is a full-service outage. Isolate the whole handler body — on any
      // throw, log it and return a GENERIC error to just this socket (never
      // leak internals), and never let the exception escape the listener.
      try {
        let message;
        try {
          message = JSON.parse(raw.toString());
        } catch {
          send(socket, {
            type: MESSAGE_TYPES.ERROR,
            message: "Invalid JSON message",
          });
          return;
        }
        if (!isPlainObject(message) || message.diagramId !== diagramId) {
          send(socket, {
            type: MESSAGE_TYPES.ERROR,
            message: "Invalid diagram message",
          });
          return;
        }

        if (message.type === MESSAGE_TYPES.JOIN) {
          // In dev/open mode (no authenticated identity) the client supplies its
          // own participant, so validate it. When authenticated, identity is
          // derived from the token and the client's claim is ignored entirely.
          if (!socket.identity && !isValidParticipant(message.participant)) {
            send(socket, {
              type: MESSAGE_TYPES.ERROR,
              message: "Invalid participant",
            });
            return;
          }
          // The diagram can be DELETEd between the upgrade existence check and
          // this JOIN message; store.get would then return null. Reject cleanly
          // instead of dereferencing a null diagram.
          const diagram = store.get(diagramId);
          if (!diagram) {
            send(socket, {
              type: MESSAGE_TYPES.ERROR,
              message: "Diagram not found",
            });
            return;
          }
          // Ownership (lock/operation clientId) is always a SERVER-assigned id,
          // never anything the client chose. Display identity comes from the
          // token when authenticated, or the client's claim in dev/open mode.
          socket.sessionId = crypto.randomUUID();
          socket.participant = socket.identity
            ? {
                clientId: socket.sessionId,
                userId: socket.identity.userId,
                displayName: socket.identity.displayName,
                color: socket.identity.color,
              }
            : { ...message.participant, clientId: socket.sessionId };
          // Tell the client its authoritative, server-assigned identity so it
          // uses this clientId on the wire and for all self-comparisons.
          send(socket, {
            type: MESSAGE_TYPES.JOINED,
            diagramId,
            version: diagram.version,
            clientId: socket.participant.clientId,
            displayName: socket.participant.displayName,
            color: socket.participant.color,
          });
          if (message.lastVersion !== diagram.version) {
            send(socket, {
              type: MESSAGE_TYPES.SNAPSHOT,
              diagramId,
              ...diagram,
            });
          }
          send(socket, {
            type: MESSAGE_TYPES.TABLE_LOCK_STATE,
            diagramId,
            locks: tableLocks.list(diagramId),
          });
          broadcastPresence(diagramId);
          return;
        }

        if (!socket.participant) {
          send(socket, {
            type: MESSAGE_TYPES.ERROR,
            message: "Join is required",
          });
          return;
        }

        if (message.type === MESSAGE_TYPES.OPERATION) {
          const valid =
            CLIENT_ID_PATTERN.test(message.clientId || "") &&
            message.clientId === socket.participant.clientId &&
            CLIENT_ID_PATTERN.test(message.operationId || "") &&
            Number.isInteger(message.baseVersion) &&
            isPlainObject(message.operation) &&
            message.operation.type === "snapshot.replace" &&
            isPlainObject(message.operation.payload?.document);
          if (!valid) {
            send(socket, {
              type: MESSAGE_TYPES.ERROR,
              message: "Invalid operation",
            });
            return;
          }
          // Structural gate: reject documents that don't look like a diagram
          // BEFORE persisting or rebroadcasting to any peer.
          if (!isDiagramDocument(message.operation.payload.document)) {
            send(socket, {
              type: MESSAGE_TYPES.ERROR,
              message: "Invalid diagram document",
            });
            return;
          }
          // Validate the name (same rule as REST). A non-string name would
          // otherwise reach the SQLite bind and throw synchronously, and an
          // over-long name would bypass the REST length cap.
          if (!isValidDiagramName(message.operation.payload.name)) {
            send(socket, {
              type: MESSAGE_TYPES.ERROR,
              message: "Invalid diagram name",
            });
            return;
          }
          const result = store.updateSnapshot({
            id: diagramId,
            name: message.operation.payload.name,
            document: message.operation.payload.document,
            baseVersion: message.baseVersion,
            operationId: message.operationId,
          });
          // The diagram may have been deleted before this write; updateSnapshot
          // then returns { status: "not_found" } with NO `diagram` field.
          // Handle it explicitly rather than dereferencing result.diagram.
          if (result.status === "not_found") {
            send(socket, {
              type: MESSAGE_TYPES.ERROR,
              message: "Diagram not found",
            });
            return;
          }
          if (result.status === "conflict") {
            send(socket, {
              type: MESSAGE_TYPES.RESYNC_REQUIRED,
              diagramId,
              ...result.diagram,
            });
            return;
          }
          const applied = {
            type: MESSAGE_TYPES.OPERATION_APPLIED,
            diagramId,
            clientId: message.clientId,
            operationId: message.operationId,
            version: result.diagram.version,
            operation: {
              type: "snapshot.replace",
              payload: {
                name: result.diagram.name,
                document: result.diagram.document,
              },
            },
          };
          broadcast(diagramId, applied);
          return;
        }

        if (message.type === MESSAGE_TYPES.OPERATION_PREVIEW) {
          if (!isValidOperationPreview(message.operation)) {
            send(socket, {
              type: MESSAGE_TYPES.ERROR,
              message: "Invalid operation preview",
            });
            return;
          }
          if (
            !tableLocks.owns(
              diagramId,
              message.operation.payload.tableId ?? message.operation.payload.id,
              socket.participant.clientId,
            )
          ) {
            send(socket, {
              type: MESSAGE_TYPES.ERROR,
              message: "A table edit lock is required",
            });
            return;
          }
          broadcast(
            diagramId,
            {
              type: MESSAGE_TYPES.OPERATION_PREVIEW,
              diagramId,
              clientId: socket.participant.clientId,
              operation: message.operation,
            },
            socket,
          );
          return;
        }

        if (message.type === MESSAGE_TYPES.TABLE_LOCK_ACQUIRE) {
          if (
            !isValidEntityId(message.tableId) ||
            !CLIENT_ID_PATTERN.test(message.requestId || "")
          ) {
            send(socket, {
              type: MESSAGE_TYPES.ERROR,
              message: "Invalid table lock request",
            });
            return;
          }
          const result = tableLocks.acquire(
            diagramId,
            message.tableId,
            socket.participant,
          );
          send(socket, {
            type: result.granted
              ? MESSAGE_TYPES.TABLE_LOCK_GRANTED
              : MESSAGE_TYPES.TABLE_LOCK_DENIED,
            diagramId,
            requestId: message.requestId,
            lock: result.lock,
          });
          if (result.granted) broadcastTableLocks(diagramId);
          return;
        }

        if (message.type === MESSAGE_TYPES.TABLE_LOCK_RENEW) {
          if (
            isValidEntityId(message.tableId) &&
            typeof message.token === "string" &&
            CLIENT_ID_PATTERN.test(message.token) &&
            tableLocks.renew(
              diagramId,
              message.tableId,
              socket.participant.clientId,
              message.token,
            )
          ) {
            broadcastTableLocks(diagramId);
          }
          return;
        }

        if (message.type === MESSAGE_TYPES.TABLE_LOCK_RELEASE) {
          if (
            isValidEntityId(message.tableId) &&
            typeof message.token === "string" &&
            CLIENT_ID_PATTERN.test(message.token) &&
            tableLocks.release(
              diagramId,
              message.tableId,
              socket.participant.clientId,
              message.token,
            )
          ) {
            broadcastTableLocks(diagramId);
          }
          return;
        }

        if (message.type === MESSAGE_TYPES.CURSOR) {
          const { x, y, selected } = message;
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;
          broadcast(
            diagramId,
            {
              type: MESSAGE_TYPES.CURSOR,
              diagramId,
              clientId: socket.participant.clientId,
              x,
              y,
              selected: typeof selected === "string" ? selected : null,
            },
            socket,
          );
          return;
        }

        if (message.type === MESSAGE_TYPES.PING) {
          send(socket, { type: MESSAGE_TYPES.PONG, diagramId });
          return;
        }
        send(socket, {
          type: MESSAGE_TYPES.ERROR,
          message: "Unsupported message type",
        });
      } catch (error) {
        // Last line of defense for this socket's message: log for operators,
        // return a generic error to the client (never error.message), and keep
        // the shared process alive for every other collaborator.
        console.error(
          "[collab] Error processing WebSocket message:",
          error,
        );
        send(socket, {
          type: MESSAGE_TYPES.ERROR,
          message: "Server error processing message",
        });
      }
    });

    socket.on("close", () => {
      const room = rooms.get(diagramId);
      room?.delete(socket);
      const releasedLocks = socket.participant
        ? tableLocks.releaseClient(diagramId, socket.participant.clientId)
        : false;
      if (room?.size === 0) rooms.delete(diagramId);
      else {
        broadcastPresence(diagramId);
        if (releasedLocks) broadcastTableLocks(diagramId);
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, 30_000);
  heartbeat.unref();
  const lockSweep = setInterval(() => {
    for (const diagramId of tableLocks.sweep()) {
      broadcastTableLocks(diagramId);
    }
  }, 2_000);
  lockSweep.unref();
  wss.on("close", () => clearInterval(heartbeat));
  wss.on("close", () => clearInterval(lockSweep));
  return wss;
}
