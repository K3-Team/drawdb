import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { createDiagramStore, openDatabase } from "./database.js";
import { createApplication } from "./index.js";
import { isValidOperationPreview } from "./protocol.js";
import { createTableLockManager } from "./tableLocks.js";
import { isDiagramDocument } from "./validateDocument.js";

/* global process */

function waitForMessage(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for WebSocket message"));
    }, 2_000);
    const onMessage = (raw) => {
      const message = JSON.parse(raw.toString());
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

function openSocket(url, options) {
  return new Promise((resolve, reject) => {
    const socket = options ? new WebSocket(url, options) : new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

const COLLAB_ENV_KEYS = ["COLLAB_TOKENS", "COLLAB_TOKENS_FILE", "ALLOWED_ORIGINS"];

function saveCollabEnv() {
  const saved = {};
  for (const key of COLLAB_ENV_KEYS) saved[key] = process.env[key];
  return () => {
    for (const key of COLLAB_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };
}

test("isDiagramDocument accepts a well-formed diagram and rejects malformed ones", () => {
  // Schema-form alias: relationships / subjectAreas.
  assert.equal(
    isDiagramDocument({
      tables: [],
      relationships: [],
      notes: [],
      subjectAreas: [],
    }),
    true,
  );
  // Real wire-form alias: this is the EXACT shape buildDocument() in
  // src/components/Workspace.jsx produces and sends over the wire
  // (references / areas, plus assorted non-array fields). Must be accepted,
  // or every real client save gets rejected by the server.
  assert.equal(
    isDiagramDocument({
      database: "generic",
      tables: [],
      references: [],
      notes: [],
      areas: [],
      pan: { x: 0, y: 0 },
      zoom: 1,
    }),
    true,
  );
  assert.equal(
    isDiagramDocument({
      tables: "nope",
      relationships: [],
      notes: [],
      subjectAreas: [],
    }),
    false,
  );
  // Missing BOTH aliases for relationships/subjectAreas must still be rejected.
  assert.equal(isDiagramDocument({ tables: [], notes: [] }), false);
  assert.equal(isDiagramDocument({ tables: [] }), false); // missing required arrays
  assert.equal(isDiagramDocument(null), false);
  assert.equal(isDiagramDocument("string"), false);
  assert.equal(isDiagramDocument([]), false);
});

test("diagram persistence enforces optimistic versions and operation IDs", () => {
  const database = openDatabase(":memory:");
  const store = createDiagramStore(database);

  const created = store.create({
    id: "diagram-1",
    name: "One",
    document: { tables: [] },
  });
  assert.equal(created.version, 1);

  const updated = store.updateSnapshot({
    id: "diagram-1",
    name: "Updated",
    document: { tables: [{ id: "table-1" }] },
    baseVersion: 1,
    operationId: "operation-1",
  });
  assert.equal(updated.status, "updated");
  assert.equal(updated.diagram.version, 2);

  const duplicate = store.updateSnapshot({
    id: "diagram-1",
    name: "Duplicate",
    document: {},
    baseVersion: 1,
    operationId: "operation-1",
  });
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.diagram.name, "Updated");

  const conflict = store.updateSnapshot({
    id: "diagram-1",
    name: "Stale",
    document: {},
    baseVersion: 1,
    operationId: "operation-2",
  });
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.diagram.version, 2);
  database.close();
});

test("validates ephemeral table movement previews", () => {
  assert.equal(
    isValidOperationPreview({
      type: "table.move",
      payload: { id: 0, x: 10, y: 20 },
    }),
    true,
  );
  assert.equal(
    isValidOperationPreview({
      type: "table.move",
      payload: { id: "table-1", x: 120.5, y: -40 },
    }),
    true,
  );
  assert.equal(
    isValidOperationPreview({
      type: "table.move",
      payload: { id: "../table", x: 1, y: 2 },
    }),
    false,
  );
  assert.equal(
    isValidOperationPreview({
      type: "table.move",
      payload: { id: "table-1", x: Number.NaN, y: 2 },
    }),
    false,
  );
});

test("table edit leases are exclusive and expire", () => {
  let currentTime = 1_000;
  const locks = createTableLockManager({
    leaseMs: 100,
    now: () => currentTime,
  });
  const participantA = {
    clientId: "client-a",
    displayName: "A",
    color: "#000",
  };
  const participantB = {
    clientId: "client-b",
    displayName: "B",
    color: "#fff",
  };

  const acquired = locks.acquire("diagram-1", "table-1", participantA);
  assert.equal(acquired.granted, true);
  assert.equal(locks.owns("diagram-1", "table-1", "client-a"), true);

  const denied = locks.acquire("diagram-1", "table-1", participantB);
  assert.equal(denied.granted, false);
  assert.equal(denied.lock.clientId, "client-a");

  currentTime += 101;
  const acquiredAfterExpiry = locks.acquire(
    "diagram-1",
    "table-1",
    participantB,
  );
  assert.equal(acquiredAfterExpiry.granted, true);
  assert.notEqual(acquiredAfterExpiry.lock.token, acquired.lock.token);
});

test("table lock fencing tokens are unpredictable, not sequential integers", () => {
  const locks = createTableLockManager({ now: () => 1_000 });
  const participantA = {
    clientId: "client-a",
    displayName: "A",
    color: "#000",
  };
  const participantB = {
    clientId: "client-b",
    displayName: "B",
    color: "#fff",
  };

  const lockOne = locks.acquire("diagram-1", "table-1", participantA);
  const lockTwo = locks.acquire("diagram-1", "table-2", participantB);

  // Tokens are opaque random strings, not small sequential integers like the
  // old `1`, `2`, ... fencing counter.
  assert.equal(typeof lockOne.lock.token, "string");
  assert.equal(typeof lockTwo.lock.token, "string");
  assert.ok(lockOne.lock.token.length >= 20);
  assert.ok(lockTwo.lock.token.length >= 20);
  assert.notEqual(lockOne.lock.token, lockTwo.lock.token);

  // Re-acquiring one's own lock on the same table is idempotent: same token.
  const reacquired = locks.acquire("diagram-1", "table-1", participantA);
  assert.equal(reacquired.granted, true);
  assert.equal(reacquired.lock.token, lockOne.lock.token);

  // A guessed/wrong token (a short sequential-looking string, or a
  // differently-shaped UUID) must be rejected by renew and release, while the
  // real token succeeds.
  assert.equal(locks.renew("diagram-1", "table-1", "client-a", "1"), false);
  assert.equal(
    locks.renew(
      "diagram-1",
      "table-1",
      "client-a",
      "00000000-0000-0000-0000-000000000000",
    ),
    false,
  );
  assert.equal(
    locks.renew("diagram-1", "table-1", "client-a", lockOne.lock.token),
    true,
  );
  assert.equal(locks.release("diagram-1", "table-1", "client-a", "1"), false);
  assert.equal(
    locks.release("diagram-1", "table-1", "client-a", lockOne.lock.token),
    true,
  );
});

test("WebSocket table locks reject concurrent edits", async (t) => {
  const application = createApplication({ databasePath: ":memory:" });
  application.store.create({
    id: "diagram-lock-test",
    name: "Lock test",
    document: { tables: [{ id: 0, x: 0, y: 0 }] },
  });
  await new Promise((resolve) =>
    application.server.listen(0, "127.0.0.1", resolve),
  );
  const { port } = application.server.address();
  const url = `ws://127.0.0.1:${port}/ws/diagrams/diagram-lock-test`;
  const clientA = await openSocket(url);
  const clientB = await openSocket(url);
  t.after(() => {
    clientA.close();
    clientB.close();
    application.websocket.close();
    application.server.close();
    application.database.close();
  });

  // The server assigns the authoritative clientId in the JOINED payload; the
  // participant.clientId we send is only a display hint in dev mode.
  const join = async (socket, clientId) => {
    const joined = waitForMessage(
      socket,
      (message) => message.type === "joined",
    );
    socket.send(
      JSON.stringify({
        type: "join",
        diagramId: "diagram-lock-test",
        lastVersion: 1,
        participant: { clientId, displayName: clientId, color: "#000" },
      }),
    );
    return (await joined).clientId;
  };
  const clientIdA = await join(clientA, "client-a");
  const clientIdB = await join(clientB, "client-b");

  const grantedA = waitForMessage(
    clientA,
    (message) => message.type === "table_lock_granted",
  );
  const releasedState = waitForMessage(
    clientB,
    (message) =>
      message.type === "table_lock_state" && message.locks.length === 0,
  );
  clientA.send(
    JSON.stringify({
      type: "table_lock_acquire",
      diagramId: "diagram-lock-test",
      tableId: 0,
      requestId: "request-a",
    }),
  );
  const lockA = (await grantedA).lock;

  const deniedB = waitForMessage(
    clientB,
    (message) => message.type === "table_lock_denied",
  );
  clientB.send(
    JSON.stringify({
      type: "table_lock_acquire",
      diagramId: "diagram-lock-test",
      tableId: 0,
      requestId: "request-b",
    }),
  );
  assert.equal((await deniedB).lock.clientId, clientIdA);

  const previewRejected = waitForMessage(
    clientB,
    (message) =>
      message.type === "error" &&
      message.message === "A table edit lock is required",
  );
  clientB.send(
    JSON.stringify({
      type: "operation_preview",
      diagramId: "diagram-lock-test",
      operation: {
        type: "table.move",
        payload: { id: 0, x: 10, y: 20 },
      },
    }),
  );
  await previewRejected;

  clientA.send(
    JSON.stringify({
      type: "table_lock_release",
      diagramId: "diagram-lock-test",
      tableId: 0,
      token: lockA.token,
    }),
  );
  await releasedState;
  const grantedB = waitForMessage(
    clientB,
    (message) => message.type === "table_lock_granted",
  );
  clientB.send(
    JSON.stringify({
      type: "table_lock_acquire",
      diagramId: "diagram-lock-test",
      tableId: 0,
      requestId: "request-b-after-release",
    }),
  );
  assert.equal((await grantedB).lock.clientId, clientIdB);
});

test("WS upgrade rejects when tokens are configured but no token is supplied", async (t) => {
  const restoreEnv = saveCollabEnv();
  t.after(restoreEnv);
  delete process.env.ALLOWED_ORIGINS;
  process.env.COLLAB_TOKENS =
    '{"tok-ann":{"userId":"user-ann","displayName":"Ann","color":"#123456"}}';

  const application = createApplication({ databasePath: ":memory:" });
  application.store.create({
    id: "diagram-auth",
    name: "Auth test",
    document: { tables: [] },
  });
  await new Promise((resolve) =>
    application.server.listen(0, "127.0.0.1", resolve),
  );
  const { port } = application.server.address();
  t.after(() => {
    application.websocket.close();
    application.server.close();
    application.database.close();
  });

  // No ?token= => handshake must fail (401), socket never opens.
  await assert.rejects(
    openSocket(`ws://127.0.0.1:${port}/ws/diagrams/diagram-auth`),
    /401|unexpected server response/i,
  );
});

test("WS upgrade rejects a disallowed Origin when an allowlist is configured", async (t) => {
  const restoreEnv = saveCollabEnv();
  t.after(restoreEnv);
  delete process.env.COLLAB_TOKENS;
  delete process.env.COLLAB_TOKENS_FILE;
  process.env.ALLOWED_ORIGINS = "https://good.example";

  const application = createApplication({ databasePath: ":memory:" });
  application.store.create({
    id: "diagram-origin",
    name: "Origin test",
    document: { tables: [] },
  });
  await new Promise((resolve) =>
    application.server.listen(0, "127.0.0.1", resolve),
  );
  const { port } = application.server.address();
  t.after(() => {
    application.websocket.close();
    application.server.close();
    application.database.close();
  });

  // Foreign Origin => 403, socket never opens.
  await assert.rejects(
    openSocket(`ws://127.0.0.1:${port}/ws/diagrams/diagram-origin`, {
      origin: "https://evil.example",
    }),
    /403|unexpected server response/i,
  );
});

test("WS derives participant identity from the token, ignoring a lying client", async (t) => {
  const restoreEnv = saveCollabEnv();
  t.after(restoreEnv);
  delete process.env.ALLOWED_ORIGINS;
  process.env.COLLAB_TOKENS =
    '{"tok-ann":{"userId":"user-ann","displayName":"Ann","color":"#123456"}}';

  const application = createApplication({ databasePath: ":memory:" });
  application.store.create({
    id: "diagram-identity",
    name: "Identity test",
    document: { tables: [] },
  });
  await new Promise((resolve) =>
    application.server.listen(0, "127.0.0.1", resolve),
  );
  const { port } = application.server.address();
  t.after(() => {
    application.websocket.close();
    application.server.close();
    application.database.close();
  });

  const socket = await openSocket(
    `ws://127.0.0.1:${port}/ws/diagrams/diagram-identity?token=tok-ann`,
  );
  t.after(() => socket.close());

  const joined = waitForMessage(socket, (message) => message.type === "joined");
  const presence = waitForMessage(
    socket,
    (message) => message.type === "presence",
  );
  // Client LIES about its identity — server must ignore this.
  socket.send(
    JSON.stringify({
      type: "join",
      diagramId: "diagram-identity",
      lastVersion: 0,
      participant: {
        clientId: "attacker",
        displayName: "Mallory",
        color: "#000000",
      },
    }),
  );

  // The JOINED payload carries the server-assigned clientId — never the lie.
  const joinedMessage = await joined;
  assert.equal(joinedMessage.displayName, "Ann");
  assert.notEqual(joinedMessage.clientId, "attacker");
  assert.ok(joinedMessage.clientId);

  const { participants } = await presence;
  assert.equal(participants.length, 1);
  // Display identity comes from the TOKEN, not the client's lie.
  assert.equal(participants[0].displayName, "Ann");
  assert.equal(participants[0].color, "#123456");
  assert.equal(participants[0].userId, "user-ann");
  // Ownership clientId is server-assigned, NOT the attacker's claim.
  assert.notEqual(participants[0].clientId, "attacker");
  assert.equal(participants[0].clientId, joinedMessage.clientId);
});

test("WS accepts an authenticated operation sent with the server-assigned clientId", async (t) => {
  const restoreEnv = saveCollabEnv();
  t.after(restoreEnv);
  delete process.env.ALLOWED_ORIGINS;
  process.env.COLLAB_TOKENS =
    '{"tok-ann":{"userId":"user-ann","displayName":"Ann","color":"#123456"}}';

  const application = createApplication({ databasePath: ":memory:" });
  application.store.create({
    id: "diagram-save",
    name: "Save test",
    document: { tables: [] },
  });
  await new Promise((resolve) =>
    application.server.listen(0, "127.0.0.1", resolve),
  );
  const { port } = application.server.address();
  t.after(() => {
    application.websocket.close();
    application.server.close();
    application.database.close();
  });

  const socket = await openSocket(
    `ws://127.0.0.1:${port}/ws/diagrams/diagram-save?token=tok-ann`,
  );
  t.after(() => socket.close());

  const joined = waitForMessage(socket, (message) => message.type === "joined");
  socket.send(
    JSON.stringify({
      type: "join",
      diagramId: "diagram-save",
      lastVersion: 1,
      // A real client sends its own random clientId here; the server ignores it.
      participant: {
        clientId: "local-nanoid",
        displayName: "Ann",
        color: "#123456",
      },
    }),
  );
  const clientId = (await joined).clientId;
  assert.ok(clientId);

  // The client must use the SERVER-ASSIGNED clientId on operations. Using it
  // must be ACCEPTED (this is the I-3 regression: a mismatched clientId used
  // to be rejected as "Invalid operation", breaking every authenticated save).
  const applied = waitForMessage(
    socket,
    (message) => message.type === "operation_applied",
  );
  const rejected = waitForMessage(
    socket,
    (message) =>
      message.type === "error" && message.message === "Invalid operation",
  );
  socket.send(
    JSON.stringify({
      type: "operation",
      diagramId: "diagram-save",
      clientId,
      operationId: "op-authed-1",
      baseVersion: 1,
      operation: {
        type: "snapshot.replace",
        payload: {
          name: "Renamed",
          // Real wire shape from buildDocument() (references/areas), not the
          // schema-form aliases — proves the server accepts what the actual
          // client sends.
          document: {
            database: "generic",
            tables: [{ id: 0 }],
            references: [],
            notes: [],
            areas: [],
            pan: { x: 0, y: 0 },
            zoom: 1,
          },
        },
      },
    }),
  );
  const appliedMessage = await Promise.race([
    applied,
    rejected.then((m) => {
      throw new Error(`Operation was rejected: ${m.message}`);
    }),
  ]);
  assert.equal(appliedMessage.clientId, clientId);
  assert.equal(appliedMessage.version, 2);
  assert.equal(appliedMessage.operation.payload.name, "Renamed");
  // And it persisted authoritatively.
  assert.equal(application.store.get("diagram-save").name, "Renamed");
});

test("WS rejects a structurally malformed document: no persist, no rebroadcast", async (t) => {
  const restoreEnv = saveCollabEnv();
  t.after(restoreEnv);
  delete process.env.ALLOWED_ORIGINS;
  process.env.COLLAB_TOKENS =
    '{"tok-ann":{"userId":"user-ann","displayName":"Ann","color":"#123456"},"tok-bob":{"userId":"user-bob","displayName":"Bob","color":"#654321"}}';

  const application = createApplication({ databasePath: ":memory:" });
  application.store.create({
    id: "diagram-hostile",
    name: "Hostile test",
    document: { tables: [] },
  });
  await new Promise((resolve) =>
    application.server.listen(0, "127.0.0.1", resolve),
  );
  const { port } = application.server.address();
  t.after(() => {
    application.websocket.close();
    application.server.close();
    application.database.close();
  });

  const clientA = await openSocket(
    `ws://127.0.0.1:${port}/ws/diagrams/diagram-hostile?token=tok-ann`,
  );
  const clientB = await openSocket(
    `ws://127.0.0.1:${port}/ws/diagrams/diagram-hostile?token=tok-bob`,
  );
  t.after(() => {
    clientA.close();
    clientB.close();
  });

  const join = async (socket, clientId) => {
    const joined = waitForMessage(
      socket,
      (message) => message.type === "joined",
    );
    socket.send(
      JSON.stringify({
        type: "join",
        diagramId: "diagram-hostile",
        lastVersion: 1,
        participant: { clientId, displayName: clientId, color: "#000" },
      }),
    );
    return (await joined).clientId;
  };
  const clientIdA = await join(clientA, "client-a");
  await join(clientB, "client-b");

  // B must never see a hostile document rebroadcast as operation_applied.
  let bReceivedApplied = false;
  const onBMessage = (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === "operation_applied") bReceivedApplied = true;
  };
  clientB.on("message", onBMessage);
  t.after(() => clientB.off("message", onBMessage));

  const rejected = waitForMessage(
    clientA,
    (message) => message.type === "error",
  );
  const applied = waitForMessage(
    clientA,
    (message) => message.type === "operation_applied",
  );
  clientA.send(
    JSON.stringify({
      type: "operation",
      diagramId: "diagram-hostile",
      clientId: clientIdA,
      operationId: "op-hostile-1",
      baseVersion: 1,
      operation: {
        type: "snapshot.replace",
        payload: { name: "Hijacked", document: { tables: "evil" } },
      },
    }),
  );

  // The sender gets an error, never operation_applied, for the hostile doc.
  const errorMessage = await Promise.race([
    rejected,
    applied.then(() => {
      throw new Error("Hostile document was accepted as operation_applied");
    }),
  ]);
  assert.equal(errorMessage.type, "error");

  // Give any (incorrect) broadcast a moment to arrive before asserting absence.
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(bReceivedApplied, false);

  // Nothing was persisted: version and name are unchanged.
  const stored = application.store.get("diagram-hostile");
  assert.equal(stored.version, 1);
  assert.equal(stored.name, "Hostile test");
});

test("WS dev mode (no tokens) preserves client-supplied participant identity", async (t) => {
  const restoreEnv = saveCollabEnv();
  t.after(restoreEnv);
  delete process.env.COLLAB_TOKENS;
  delete process.env.COLLAB_TOKENS_FILE;
  delete process.env.ALLOWED_ORIGINS;

  const application = createApplication({ databasePath: ":memory:" });
  application.store.create({
    id: "diagram-dev",
    name: "Dev test",
    document: { tables: [] },
  });
  await new Promise((resolve) =>
    application.server.listen(0, "127.0.0.1", resolve),
  );
  const { port } = application.server.address();
  t.after(() => {
    application.websocket.close();
    application.server.close();
    application.database.close();
  });

  const socket = await openSocket(
    `ws://127.0.0.1:${port}/ws/diagrams/diagram-dev`,
  );
  t.after(() => socket.close());

  const joined = waitForMessage(socket, (message) => message.type === "joined");
  const presence = waitForMessage(
    socket,
    (message) => message.type === "presence",
  );
  socket.send(
    JSON.stringify({
      type: "join",
      diagramId: "diagram-dev",
      lastVersion: 0,
      participant: {
        clientId: "client-dev",
        displayName: "Dev User",
        color: "#abcdef",
      },
    }),
  );
  // Dev mode preserves the client-supplied DISPLAY identity, but ownership
  // clientId is still server-assigned (delivered via JOINED) so the wire
  // clientId is always authoritative in both modes.
  const clientId = (await joined).clientId;
  assert.ok(clientId);
  const { participants } = await presence;
  assert.equal(participants.length, 1);
  assert.equal(participants[0].displayName, "Dev User");
  assert.equal(participants[0].color, "#abcdef");
  assert.equal(participants[0].clientId, clientId);
  assert.notEqual(participants[0].clientId, "client-dev");
});

test("DELETE /api/diagrams/:id requires auth: 401 without a token, 204 with the right one", async (t) => {
  const restoreEnv = saveCollabEnv();
  t.after(restoreEnv);
  delete process.env.ALLOWED_ORIGINS;
  process.env.COLLAB_TOKENS =
    '{"tok-ann":{"userId":"user-ann","displayName":"Ann","color":"#123456"}}';

  const application = createApplication({ databasePath: ":memory:" });
  application.store.create({
    id: "diagram-delete-auth",
    name: "Delete auth test",
    document: { tables: [] },
  });
  await new Promise((resolve) =>
    application.server.listen(0, "127.0.0.1", resolve),
  );
  const { port } = application.server.address();
  t.after(() => {
    application.websocket.close();
    application.server.close();
    application.database.close();
  });

  const url = `http://127.0.0.1:${port}/api/diagrams/diagram-delete-auth`;

  // No Authorization header => 401, diagram must remain untouched.
  const unauthenticated = await fetch(url, { method: "DELETE" });
  assert.equal(unauthenticated.status, 401);
  assert.ok(application.store.get("diagram-delete-auth"));

  // Valid Bearer token => the delete is actually performed.
  const authenticated = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: "Bearer tok-ann" },
  });
  assert.equal(authenticated.status, 204);
  assert.equal(application.store.get("diagram-delete-auth"), null);
});

// The real wire document shape produced by buildDocument() (references/areas),
// which the isDiagramDocument gate requires for a valid operation.
const WIRE_DOCUMENT = {
  database: "generic",
  tables: [{ id: 0 }],
  references: [],
  notes: [],
  areas: [],
  pan: { x: 0, y: 0 },
  zoom: 1,
};

// Shared helper: send JOIN and resolve with the server-assigned clientId.
async function joinDiagram(socket, diagramId, participant) {
  const joined = waitForMessage(socket, (message) => message.type === "joined");
  socket.send(
    JSON.stringify({
      type: "join",
      diagramId,
      lastVersion: 1,
      participant: participant ?? {
        clientId: "local",
        displayName: "Local",
        color: "#000",
      },
    }),
  );
  return (await joined).clientId;
}

// C1 — a non-string `name` used to reach the SQLite bind and throw
// synchronously, killing the whole shared process. The server must reject it
// cleanly AND stay up: a subsequent VALID operation from the same client must
// still succeed (which is impossible if the process had crashed).
test("WS operation with a non-string name is rejected and the server survives", async (t) => {
  const restoreEnv = saveCollabEnv();
  t.after(restoreEnv);
  delete process.env.ALLOWED_ORIGINS;
  process.env.COLLAB_TOKENS =
    '{"tok-ann":{"userId":"user-ann","displayName":"Ann","color":"#123456"}}';

  const application = createApplication({ databasePath: ":memory:" });
  application.store.create({
    id: "diagram-c1",
    name: "C1 test",
    document: { tables: [] },
  });
  await new Promise((resolve) =>
    application.server.listen(0, "127.0.0.1", resolve),
  );
  const { port } = application.server.address();
  t.after(() => {
    application.websocket.close();
    application.server.close();
    application.database.close();
  });

  const socket = await openSocket(
    `ws://127.0.0.1:${port}/ws/diagrams/diagram-c1?token=tok-ann`,
  );
  t.after(() => socket.close());
  const clientId = await joinDiagram(socket, "diagram-c1");

  // Malicious input: an object where a string name is expected. Pre-fix this
  // threw inside better-sqlite3's bind and crashed the process.
  const rejected = waitForMessage(
    socket,
    (message) =>
      message.type === "error" && message.message === "Invalid diagram name",
  );
  socket.send(
    JSON.stringify({
      type: "operation",
      diagramId: "diagram-c1",
      clientId,
      operationId: "op-c1-bad",
      baseVersion: 1,
      operation: {
        type: "snapshot.replace",
        payload: { name: { evil: 1 }, document: WIRE_DOCUMENT },
      },
    }),
  );
  const errorMessage = await rejected;
  assert.equal(errorMessage.message, "Invalid diagram name");
  // Nothing was persisted by the bad op.
  assert.equal(application.store.get("diagram-c1").version, 1);

  // PROOF the server stayed up: a valid operation now succeeds on the same
  // socket. If the process had crashed, this would time out.
  const applied = waitForMessage(
    socket,
    (message) => message.type === "operation_applied",
  );
  socket.send(
    JSON.stringify({
      type: "operation",
      diagramId: "diagram-c1",
      clientId,
      operationId: "op-c1-good",
      baseVersion: 1,
      operation: {
        type: "snapshot.replace",
        payload: { name: "Renamed", document: WIRE_DOCUMENT },
      },
    }),
  );
  const appliedMessage = await applied;
  assert.equal(appliedMessage.version, 2);
  assert.equal(application.store.get("diagram-c1").name, "Renamed");
});

// C2 — a diagram DELETEd between the WS upgrade existence check and the JOIN
// message left store.get returning null, and JOIN dereferenced diagram.version
// → crash. The server must reject with "Diagram not found" and stay up.
test("WS join on a diagram deleted after upgrade is rejected and the server survives", async (t) => {
  const restoreEnv = saveCollabEnv();
  t.after(restoreEnv);
  delete process.env.ALLOWED_ORIGINS;
  process.env.COLLAB_TOKENS =
    '{"tok-ann":{"userId":"user-ann","displayName":"Ann","color":"#123456"}}';

  const application = createApplication({ databasePath: ":memory:" });
  application.store.create({
    id: "diagram-c2",
    name: "C2 test",
    document: { tables: [] },
  });
  await new Promise((resolve) =>
    application.server.listen(0, "127.0.0.1", resolve),
  );
  const { port } = application.server.address();
  t.after(() => {
    application.websocket.close();
    application.server.close();
    application.database.close();
  });

  // Both sockets pass the upgrade existence check while the diagram still
  // exists. socketA joins normally.
  const socketA = await openSocket(
    `ws://127.0.0.1:${port}/ws/diagrams/diagram-c2?token=tok-ann`,
  );
  const socketB = await openSocket(
    `ws://127.0.0.1:${port}/ws/diagrams/diagram-c2?token=tok-ann`,
  );
  t.after(() => {
    socketA.close();
    socketB.close();
  });
  await joinDiagram(socketA, "diagram-c2");

  // Delete the diagram out from under the already-upgraded socketB.
  assert.equal(application.store.delete("diagram-c2"), true);

  // socketB's JOIN now hits a null diagram — pre-fix this crashed the process.
  const rejected = waitForMessage(
    socketB,
    (message) =>
      message.type === "error" && message.message === "Diagram not found",
  );
  socketB.send(
    JSON.stringify({
      type: "join",
      diagramId: "diagram-c2",
      lastVersion: 1,
      participant: { clientId: "b", displayName: "B", color: "#000" },
    }),
  );
  assert.equal((await rejected).message, "Diagram not found");

  // PROOF the server stayed up: a fresh diagram accepts a full join + valid op.
  application.store.create({
    id: "diagram-c2-fresh",
    name: "Fresh",
    document: { tables: [] },
  });
  const socketC = await openSocket(
    `ws://127.0.0.1:${port}/ws/diagrams/diagram-c2-fresh?token=tok-ann`,
  );
  t.after(() => socketC.close());
  const clientIdC = await joinDiagram(socketC, "diagram-c2-fresh");
  const applied = waitForMessage(
    socketC,
    (message) => message.type === "operation_applied",
  );
  socketC.send(
    JSON.stringify({
      type: "operation",
      diagramId: "diagram-c2-fresh",
      clientId: clientIdC,
      operationId: "op-c2-good",
      baseVersion: 1,
      operation: {
        type: "snapshot.replace",
        payload: { name: "Fresh renamed", document: WIRE_DOCUMENT },
      },
    }),
  );
  assert.equal((await applied).version, 2);
});

// C3 — an operation after the diagram was deleted: updateSnapshot returns
// { status: "not_found" } with NO `diagram` field, and the handler read
// result.diagram.version → crash. The server must reject with "Diagram not
// found" and stay up.
test("WS operation on a deleted diagram is rejected and the server survives", async (t) => {
  const restoreEnv = saveCollabEnv();
  t.after(restoreEnv);
  delete process.env.ALLOWED_ORIGINS;
  process.env.COLLAB_TOKENS =
    '{"tok-ann":{"userId":"user-ann","displayName":"Ann","color":"#123456"}}';

  const application = createApplication({ databasePath: ":memory:" });
  application.store.create({
    id: "diagram-c3",
    name: "C3 test",
    document: { tables: [] },
  });
  await new Promise((resolve) =>
    application.server.listen(0, "127.0.0.1", resolve),
  );
  const { port } = application.server.address();
  t.after(() => {
    application.websocket.close();
    application.server.close();
    application.database.close();
  });

  const socket = await openSocket(
    `ws://127.0.0.1:${port}/ws/diagrams/diagram-c3?token=tok-ann`,
  );
  t.after(() => socket.close());
  const clientId = await joinDiagram(socket, "diagram-c3");

  // Delete the diagram, then send an otherwise-valid operation against it.
  assert.equal(application.store.delete("diagram-c3"), true);

  const rejected = waitForMessage(
    socket,
    (message) =>
      message.type === "error" && message.message === "Diagram not found",
  );
  socket.send(
    JSON.stringify({
      type: "operation",
      diagramId: "diagram-c3",
      clientId,
      operationId: "op-c3-deleted",
      baseVersion: 1,
      operation: {
        type: "snapshot.replace",
        payload: { name: "Ghost", document: WIRE_DOCUMENT },
      },
    }),
  );
  assert.equal((await rejected).message, "Diagram not found");

  // PROOF the server stayed up: a fresh diagram accepts a full join + valid op.
  application.store.create({
    id: "diagram-c3-fresh",
    name: "Fresh",
    document: { tables: [] },
  });
  const socketC = await openSocket(
    `ws://127.0.0.1:${port}/ws/diagrams/diagram-c3-fresh?token=tok-ann`,
  );
  t.after(() => socketC.close());
  const clientIdC = await joinDiagram(socketC, "diagram-c3-fresh");
  const applied = waitForMessage(
    socketC,
    (message) => message.type === "operation_applied",
  );
  socketC.send(
    JSON.stringify({
      type: "operation",
      diagramId: "diagram-c3-fresh",
      clientId: clientIdC,
      operationId: "op-c3-good",
      baseVersion: 1,
      operation: {
        type: "snapshot.replace",
        payload: { name: "Fresh renamed", document: WIRE_DOCUMENT },
      },
    }),
  );
  assert.equal((await applied).version, 2);
});
