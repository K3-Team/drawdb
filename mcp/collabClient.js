import { WebSocket } from "ws";
import { nanoid } from "nanoid";
import { MESSAGE_TYPES } from "../server/protocol.js";

// Headless collaboration participant for the MCP service.
//
// It speaks the exact same WebSocket protocol the browser does
// (src/context/CollabContext.jsx) so that AI edits flow through the already
// hardened validation + optimistic-concurrency + broadcast path in
// server/websocket.js. The MCP service never touches the SQLite store or adds
// new message types: every mutation is one `snapshot.replace` OPERATION.
//
// The one primitive tools use is `mutate(fn)`: read the cached document, run a
// pure transform, submit it as a snapshot with the current baseVersion, and —
// on a version conflict (RESYNC_REQUIRED) — re-read and re-apply. Because each
// tool is a small semantic change, re-applying onto a newer document is safe,
// which is what makes concurrent human+AI editing converge instead of clobber.

// Distinguishes a server-signalled version conflict (retryable) from a real
// failure, so `mutate` only retries the former.
export class ResyncError extends Error {
  constructor() {
    super("Diagram changed underneath us; resynced");
    this.name = "ResyncError";
  }
}

export function createCollabClient({
  url,
  diagramId,
  token,
  origin,
  participant = { clientId: "mcp", displayName: "AI Assistant", color: "#7c3aed" },
  ackTimeoutMs = 10_000,
  connectTimeoutMs = 10_000,
  maxRetries = 5,
}) {
  let socket = null;
  let connected = false;
  let version = null;
  let clientId = null;
  let name = null;
  let document = null;
  const pending = new Map(); // operationId -> { resolve, reject }
  const updateListeners = new Set();

  const wsUrl = () => {
    const base = `${url}/ws/diagrams/${encodeURIComponent(diagramId)}`;
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  };

  const emitUpdate = () => {
    for (const cb of updateListeners) {
      try {
        cb({ name, document, version });
      } catch {
        /* a listener must never break the socket */
      }
    }
  };

  const handleMessage = (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (message.type) {
      case MESSAGE_TYPES.JOINED:
        version = message.version;
        clientId = message.clientId;
        return;
      case MESSAGE_TYPES.SNAPSHOT:
        version = message.version;
        name = message.name ?? name;
        document = message.document ?? document;
        emitUpdate();
        return;
      case MESSAGE_TYPES.RESYNC_REQUIRED:
        version = message.version;
        name = message.name ?? name;
        document = message.document ?? document;
        for (const p of pending.values()) p.reject(new ResyncError());
        pending.clear();
        emitUpdate();
        return;
      case MESSAGE_TYPES.OPERATION_APPLIED: {
        version = message.version;
        const payload = message.operation?.payload;
        if (payload) {
          name = payload.name ?? name;
          document = payload.document ?? document;
        }
        const p = pending.get(message.operationId);
        if (p) {
          pending.delete(message.operationId);
          p.resolve(message);
        } else {
          // Another participant's change — keep our cache current so the next
          // mutate re-applies onto live state.
          emitUpdate();
        }
        return;
      }
      default:
        // presence / cursor / table_lock_* / error are not needed for v1.
        return;
    }
  };

  const connect = () =>
    new Promise((resolve, reject) => {
      if (connected) {
        resolve();
        return;
      }
      const options = origin ? { headers: { origin } } : undefined;
      socket = new WebSocket(wsUrl(), options);
      const timer = setTimeout(() => {
        reject(new Error("Timed out connecting to the collaboration server"));
        socket?.close();
      }, connectTimeoutMs);
      timer.unref?.();

      socket.on("open", () => {
        socket.send(
          JSON.stringify({
            type: MESSAGE_TYPES.JOIN,
            diagramId,
            participant,
            // A sentinel that never equals a real version (>= 1) so the server
            // always replies with a full SNAPSHOT — our first read of the doc.
            lastVersion: -1,
          }),
        );
      });
      socket.on("message", (raw) => {
        handleMessage(raw);
        // Resolve once we have both identity (JOINED) and the document
        // (SNAPSHOT). SNAPSHOT always follows JOINED given the -1 sentinel.
        if (!connected && clientId !== null && document !== null) {
          connected = true;
          clearTimeout(timer);
          resolve();
        }
      });
      socket.on("error", (err) => {
        clearTimeout(timer);
        if (!connected) reject(err);
      });
      socket.on("close", () => {
        connected = false;
        for (const p of pending.values())
          p.reject(new Error("Collaboration connection closed"));
        pending.clear();
      });
    });

  const sendOperation = (nextName, nextDocument) =>
    new Promise((resolve, reject) => {
      if (!connected || socket?.readyState !== WebSocket.OPEN) {
        reject(new Error("Collaboration connection is unavailable"));
        return;
      }
      const operationId = nanoid();
      pending.set(operationId, { resolve, reject });
      socket.send(
        JSON.stringify({
          type: MESSAGE_TYPES.OPERATION,
          diagramId,
          clientId,
          operationId,
          baseVersion: version,
          operation: {
            type: "snapshot.replace",
            payload: { name: nextName, document: nextDocument },
          },
        }),
      );
      const timer = setTimeout(() => {
        if (!pending.has(operationId)) return;
        pending.delete(operationId);
        reject(new Error("Timed out waiting for the save acknowledgement"));
      }, ackTimeoutMs);
      timer.unref?.();
    });

  // Run a pure transform against the current document and persist it as one
  // snapshot. `fn(doc)` receives a mutable clone, mutates it in place, and
  // returns the tool's result value (e.g. a new id). Retries on version
  // conflict by re-applying onto the freshly resynced document.
  const mutate = async (fn) => {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (!connected) throw new Error("Not connected to a diagram");
      const draft = structuredClone(document);
      const result = fn(draft);
      try {
        await sendOperation(name, draft);
        return result;
      } catch (err) {
        lastError = err;
        if (err instanceof ResyncError) continue; // doc/version already updated
        throw err;
      }
    }
    throw lastError ?? new Error("mutate: exceeded retry budget");
  };

  return {
    connect,
    mutate,
    close() {
      connected = false;
      socket?.close();
    },
    onUpdate(cb) {
      updateListeners.add(cb);
      return () => updateListeners.delete(cb);
    },
    getState() {
      return { name, document, version, clientId, connected };
    },
  };
}
