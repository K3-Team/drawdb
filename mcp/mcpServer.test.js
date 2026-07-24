import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApplication } from "../server/index.js";
import { createMcpApplication } from "./index.js";

/* global process */

const TOKEN = "tok-integration";

function listen(server) {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server.address().port)),
  );
}

// Boot a collab server + an MCP server pointed at it, both sharing one token
// map. Returns the MCP endpoint URL and the collab ws base.
async function boot(t) {
  process.env.COLLAB_TOKENS = JSON.stringify({
    [TOKEN]: { userId: "ai", displayName: "AI", color: "#7c3aed" },
  });
  delete process.env.COLLAB_REQUIRE_AUTH;
  delete process.env.ALLOWED_ORIGINS;
  delete process.env.NODE_ENV;

  const collab = createApplication({ databasePath: ":memory:" });
  const collabPort = await listen(collab.server);

  process.env.COLLAB_URL = `http://127.0.0.1:${collabPort}`;
  const mcp = createMcpApplication();
  const mcpPort = await listen(mcp.httpServer);

  t.after(() => {
    mcp.httpServer.close();
    collab.websocket.close();
    collab.server.close();
    collab.database.close();
    delete process.env.COLLAB_TOKENS;
    delete process.env.COLLAB_URL;
  });

  return {
    mcpUrl: `http://127.0.0.1:${mcpPort}/mcp`,
    wsBase: `ws://127.0.0.1:${collabPort}`,
  };
}

async function connectClient(mcpUrl, token) {
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: token
      ? { headers: { authorization: `Bearer ${token}` } }
      : {},
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

const parse = (result) => JSON.parse(result.content[0].text);

test("unauthenticated MCP connection is rejected", async (t) => {
  const { mcpUrl } = await boot(t);
  await assert.rejects(() => connectClient(mcpUrl, "wrong-token"));
});

test("tools create/open/add_table and broadcast to a collaborator", async (t) => {
  const { mcpUrl, wsBase } = await boot(t);
  const client = await connectClient(mcpUrl, TOKEN);
  t.after(() => client.close());

  const tools = await client.listTools();
  const names = tools.tools.map((tl) => tl.name);
  assert.ok(names.includes("add_table"));
  assert.ok(names.includes("import_dbml"));
  assert.ok(names.length >= 25, `expected the full tool surface, got ${names.length}`);

  // create_diagram opens it for editing.
  const created = parse(
    await client.callTool({
      name: "create_diagram",
      arguments: { name: "My schema", database: "postgresql" },
    }),
  );
  const diagramId = created.id;
  assert.ok(diagramId);

  // A plain WS collaborator joins the same room to observe live broadcasts.
  const observer = new WebSocket(
    `${wsBase}/ws/diagrams/${diagramId}?token=${TOKEN}`,
  );
  await new Promise((resolve, reject) => {
    observer.once("open", resolve);
    observer.once("error", reject);
  });
  t.after(() => observer.close());
  observer.send(
    JSON.stringify({ type: "join", diagramId, lastVersion: -1 }),
  );
  const sawTable = new Promise((resolve) => {
    observer.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      const tables =
        msg.operation?.payload?.document?.tables ?? msg.document?.tables;
      if (tables?.some((tbl) => tbl.name === "users")) resolve(msg);
    });
  });

  // add_table through MCP -> persisted and broadcast to the observer.
  const added = parse(
    await client.callTool({
      name: "add_table",
      arguments: { name: "users" },
    }),
  );
  assert.ok(added.id, "add_table returned a table id");

  await sawTable; // rejects the test via timeout if no broadcast arrives

  // add_field targets the returned table id.
  const field = parse(
    await client.callTool({
      name: "add_field",
      arguments: { tableId: added.id, field: { name: "email", type: "varchar" } },
    }),
  );
  assert.ok(field.id);

  // get_diagram reflects the edits.
  const diagram = parse(await client.callTool({ name: "get_diagram", arguments: {} }));
  const users = diagram.tables.find((tbl) => tbl.name === "users");
  assert.ok(users.fields.some((f) => f.name === "email"));
});

test("a tool error is reported without an open diagram", async (t) => {
  const { mcpUrl } = await boot(t);
  const client = await connectClient(mcpUrl, TOKEN);
  t.after(() => client.close());
  const result = await client.callTool({ name: "add_table", arguments: { name: "x" } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /No diagram is open/);
});
