import assert from "node:assert/strict";
import test from "node:test";
import { registerTools } from "./tools.js";

// Registers the full tool surface against a stub McpServer + session and
// asserts (a) every expected tool is registered with an input schema and
// (b) each handler returns cleanly (no uncaught throw) — mutating/read tools
// surface a tool error when no diagram is open, lifecycle tools succeed.

const EXPECTED = [
  "list_diagrams", "create_diagram", "open_diagram", "get_diagram", "get_table",
  "add_table", "update_table", "delete_table",
  "add_field", "update_field", "delete_field",
  "add_relationship", "update_relationship", "delete_relationship",
  "add_area", "update_area", "delete_area",
  "add_note", "update_note", "delete_note",
  "add_enum", "update_enum", "delete_enum",
  "add_type", "update_type", "delete_type",
  "set_database", "import_diagram", "import_dbml", "export_dbml", "export_sql",
];

const LIFECYCLE = new Set(["list_diagrams", "create_diagram", "open_diagram"]);

function collect() {
  const registered = new Map();
  const server = {
    registerTool(name, config, cb) {
      registered.set(name, { config, cb });
    },
  };
  const session = {
    requireActive() {
      throw new Error("No diagram is open");
    },
    listDiagrams: async () => [],
    createDiagram: async () => ({ id: "x", name: "x" }),
    openDiagram: async () => ({ diagramId: "x" }),
  };
  registerTools(server, session);
  return registered;
}

test("registers exactly the expected tool surface, each with a schema", () => {
  const registered = collect();
  assert.deepEqual([...registered.keys()].sort(), [...EXPECTED].sort());
  assert.equal(registered.size, 31);
  for (const [name, { config }] of registered) {
    assert.ok(config.inputSchema, `${name} has an inputSchema`);
    assert.equal(typeof config.description, "string");
    assert.ok(config.description.length > 0, `${name} has a description`);
  }
});

test("every handler returns a well-formed result without throwing", async () => {
  const registered = collect();
  for (const [name, { cb }] of registered) {
    const result = await cb({});
    assert.ok(Array.isArray(result.content), `${name} returns content[]`);
    assert.equal(typeof result.content[0].text, "string");
    if (LIFECYCLE.has(name)) {
      assert.notEqual(result.isError, true, `${name} should succeed`);
    } else {
      assert.equal(result.isError, true, `${name} errors with no open diagram`);
      assert.match(result.content[0].text, /No diagram is open/);
    }
  }
});
