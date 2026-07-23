import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { createDiagramStore, openDatabase } from "./database.js";
import { createApplication } from "./index.js";
import { isValidOperationPreview } from "./protocol.js";
import { createTableLockManager } from "./tableLocks.js";

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
    await joined;
  };
  await join(clientA, "client-a");
  await join(clientB, "client-b");

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
  assert.equal((await deniedB).lock.clientId, "client-a");

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
  assert.equal((await grantedB).lock.clientId, "client-b");
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
  const { participants } = await presence;
  assert.equal(participants.length, 1);
  // Identity comes from the TOKEN, not the client's lie.
  assert.equal(participants[0].clientId, "user-ann");
  assert.equal(participants[0].displayName, "Ann");
  assert.equal(participants[0].color, "#123456");
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
  const { participants } = await presence;
  assert.equal(participants.length, 1);
  assert.equal(participants[0].clientId, "client-dev");
  assert.equal(participants[0].displayName, "Dev User");
});
