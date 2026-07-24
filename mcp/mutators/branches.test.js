import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyDocument,
  updateTable,
  updateArea,
  updateNote,
  addArea,
  addNote,
  addEnum,
  updateEnum,
  deleteEnum,
  addType,
  updateType,
  deleteType,
  addTable,
  addRelationship,
  getDiagram,
  getTable,
} from "./index.js";
import { importDiagram } from "./diagram.js";

test("updateTable replaces the fields array", () => {
  const doc = emptyDocument();
  const { id } = addTable(doc, { name: "t" });
  updateTable(doc, id, {
    fields: [{ name: "renamed", type: "text" }],
    name: "t2",
    color: "#abcdef",
  });
  const t = doc.tables[0];
  assert.equal(t.name, "t2");
  assert.equal(t.color, "#abcdef");
  assert.equal(t.fields.length, 1);
  assert.equal(t.fields[0].name, "renamed");
  assert.throws(() => updateTable(doc, id, { fields: "nope" }), /must be an array/);
  assert.throws(() => updateTable(doc, "missing", {}), /Table not found/);
});

test("area and note update mutate fields and reject unknown ids", () => {
  const doc = emptyDocument();
  addArea(doc, { name: "a" });
  updateArea(doc, 0, { name: "renamed", x: 5, color: "#112233" });
  assert.equal(doc.areas[0].name, "renamed");
  assert.equal(doc.areas[0].x, 5);
  assert.equal(doc.areas[0].color, "#112233");
  assert.throws(() => updateArea(doc, 9, {}), /Area not found/);

  addNote(doc, { title: "n" });
  updateNote(doc, 0, { content: "hi", title: "t2" });
  assert.equal(doc.notes[0].content, "hi");
  assert.equal(doc.notes[0].title, "t2");
  assert.throws(() => updateNote(doc, 9, {}), /Note not found/);
});

test("enum update/delete round-trip and not-found paths", () => {
  const doc = emptyDocument("postgresql");
  addEnum(doc, { name: "status", values: ["a"] });
  updateEnum(doc, "status", { values: ["a", "b"], name: "state" });
  assert.equal(doc.enums[0].name, "state");
  assert.deepEqual(doc.enums[0].values, ["a", "b"]);
  assert.throws(() => updateEnum(doc, "missing", {}), /Enum not found/);
  assert.throws(() => updateEnum(doc, "state", { values: 1 }), /must be an array/);
  deleteEnum(doc, "state");
  assert.equal(doc.enums.length, 0);
  assert.throws(() => deleteEnum(doc, "state"), /Enum not found/);
  assert.throws(() => addEnum(doc, { name: "x", values: [] }) && addEnum(doc, { name: "x" }), /already exists/);
});

test("type update/delete round-trip and validation", () => {
  const doc = emptyDocument("postgresql");
  addType(doc, { name: "addr", fields: [{ name: "city", type: "text" }] });
  updateType(doc, "addr", {
    name: "address",
    comment: "c",
    fields: [{ name: "zip", type: "text" }],
  });
  assert.equal(doc.types[0].name, "address");
  assert.equal(doc.types[0].comment, "c");
  assert.equal(doc.types[0].fields[0].name, "zip");
  assert.throws(() => updateType(doc, "missing", {}), /Type not found/);
  assert.throws(
    () => updateType(doc, "address", { fields: [{ name: "bad" }] }),
    /requires a name and type/,
  );
  deleteType(doc, "address");
  assert.equal(doc.types.length, 0);
  assert.throws(() => deleteType(doc, "address"), /Type not found/);
});

test("addRelationship rejects a missing end field", () => {
  const doc = emptyDocument();
  const a = addTable(doc, { name: "a" });
  const b = addTable(doc, { name: "b" });
  assert.throws(
    () =>
      addRelationship(doc, {
        startTableId: a.id,
        startFieldId: a.fieldIds[0].id,
        endTableId: b.id,
        endFieldId: "nope",
      }),
    /End field not found/,
  );
});

test("importDiagram merge mode appends instead of replacing", () => {
  const doc = emptyDocument();
  addTable(doc, { name: "existing" });
  importDiagram(
    doc,
    {
      tables: [
        { id: "n", name: "incoming", x: 0, y: 0, fields: [], comment: "", indices: [], color: "#175e7a" },
      ],
      references: [],
      notes: [],
      areas: [],
    },
    { clearCurrent: false },
  );
  assert.equal(doc.tables.length, 2);
  assert.deepEqual(
    doc.tables.map((t) => t.name),
    ["existing", "incoming"],
  );
});

test("getDiagram and getTable read the document", () => {
  const doc = emptyDocument();
  const { id } = addTable(doc, { name: "users" });
  assert.equal(getDiagram(doc), doc);
  assert.equal(getTable(doc, { tableName: "users" }).id, id);
  assert.throws(() => getTable(doc, { tableId: "missing" }), /Table not found/);
});
