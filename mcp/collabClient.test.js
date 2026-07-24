import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../server/index.js";
import { createCollabClient } from "./collabClient.js";

/* global process */

// A minimal valid wire document (buildDocument shape). references == relationships.
const emptyDoc = () => ({
  database: "generic",
  tables: [],
  references: [],
  notes: [],
  areas: [],
});

const fixtureTable = (name) => ({
  id: name,
  name,
  x: 0,
  y: 0,
  fields: [],
  indices: [],
  comment: "",
});

// Boot an in-process collab server (no tokens => dev-open, origin unchecked) on
// an ephemeral port and seed one diagram. Returns { url, application, cleanup }.
async function bootServer(t, diagramId = "d1") {
  delete process.env.COLLAB_TOKENS;
  delete process.env.COLLAB_TOKENS_FILE;
  delete process.env.ALLOWED_ORIGINS;
  const application = createApplication({ databasePath: ":memory:" });
  application.store.create({
    id: diagramId,
    name: "Test diagram",
    document: emptyDoc(),
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
  return { url: `ws://127.0.0.1:${port}`, application };
}

test("connect resolves with the seeded document and version", async (t) => {
  const { url } = await bootServer(t);
  const client = createCollabClient({ url, diagramId: "d1" });
  t.after(() => client.close());
  await client.connect();
  const state = client.getState();
  assert.equal(state.connected, true);
  assert.equal(state.version, 1);
  assert.ok(Array.isArray(state.document.tables));
  assert.ok(state.clientId, "adopted a server-assigned clientId");
});

test("mutate persists a change and a fresh client observes it", async (t) => {
  const { url } = await bootServer(t);
  const writer = createCollabClient({ url, diagramId: "d1" });
  t.after(() => writer.close());
  await writer.connect();

  const newId = await writer.mutate((doc) => {
    doc.tables.push(fixtureTable("users"));
    return "users";
  });
  assert.equal(newId, "users");
  assert.equal(writer.getState().version, 2);

  const reader = createCollabClient({ url, diagramId: "d1" });
  t.after(() => reader.close());
  await reader.connect();
  assert.equal(reader.getState().document.tables.length, 1);
  assert.equal(reader.getState().document.tables[0].name, "users");
});

test("concurrent mutates from two clients both land (retry on conflict)", async (t) => {
  const { url } = await bootServer(t);
  const a = createCollabClient({ url, diagramId: "d1" });
  const b = createCollabClient({ url, diagramId: "d1" });
  t.after(() => {
    a.close();
    b.close();
  });
  await a.connect();
  await b.connect();

  // Both start from version 1; one wins outright, the other resyncs and
  // re-applies its change onto the winner's document.
  await Promise.all([
    a.mutate((doc) => doc.tables.push(fixtureTable("a"))),
    b.mutate((doc) => doc.tables.push(fixtureTable("b"))),
  ]);

  const reader = createCollabClient({ url, diagramId: "d1" });
  t.after(() => reader.close());
  await reader.connect();
  const names = reader
    .getState()
    .document.tables.map((tbl) => tbl.name)
    .sort();
  assert.deepEqual(names, ["a", "b"]);
});

test("mutate rejects once the connection is closed", async (t) => {
  const { url } = await bootServer(t);
  const client = createCollabClient({ url, diagramId: "d1" });
  await client.connect();
  client.close();
  await assert.rejects(
    () => client.mutate((doc) => doc.tables.push(fixtureTable("x"))),
    /Not connected/,
  );
});
