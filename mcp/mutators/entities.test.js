import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyDocument,
  addTable,
  updateTable,
  deleteTable,
  getTable,
  addField,
  updateField,
  deleteField,
  addRelationship,
  updateRelationship,
  deleteRelationship,
  addArea,
  deleteArea,
  addNote,
  deleteNote,
  addEnum,
  addType,
  setDatabase,
} from "./index.js";
import { importDiagram } from "./diagram.js";

test("addTable appends a table with a default id field and returns ids", () => {
  const doc = emptyDocument("postgresql");
  const { id, fieldIds } = addTable(doc, { name: "users" });
  assert.equal(doc.tables.length, 1);
  assert.equal(doc.tables[0].name, "users");
  assert.equal(fieldIds.length, 1);
  assert.equal(doc.tables[0].fields[0].id, fieldIds[0].id);
  assert.equal(getTable(doc, { tableId: id }).name, "users");
});

test("addTable honours provided fields and rejects a nameless table", () => {
  const doc = emptyDocument();
  addTable(doc, { name: "t", fields: [{ name: "email", type: "varchar" }] });
  assert.equal(doc.tables[0].fields[0].type, "VARCHAR");
  assert.throws(() => addTable(doc, {}), /requires a name/);
});

test("deleteTable cascades to relationships referencing it", () => {
  const doc = emptyDocument();
  const a = addTable(doc, { name: "a" });
  const b = addTable(doc, { name: "b" });
  addRelationship(doc, {
    startTableId: a.id,
    startFieldId: a.fieldIds[0].id,
    endTableId: b.id,
    endFieldId: b.fieldIds[0].id,
  });
  assert.equal(doc.references.length, 1);
  deleteTable(doc, a.id);
  assert.equal(doc.tables.length, 1);
  assert.equal(doc.references.length, 0, "relationship dropped with the table");
});

test("field add/update/delete round-trips and update-not-found throws", () => {
  const doc = emptyDocument();
  const t = addTable(doc, { name: "t" });
  const f = addField(doc, t.id, { name: "age", type: "int" });
  updateField(doc, t.id, f.id, { notNull: true });
  assert.equal(
    doc.tables[0].fields.find((x) => x.id === f.id).notNull,
    true,
  );
  deleteField(doc, t.id, f.id);
  assert.equal(doc.tables[0].fields.some((x) => x.id === f.id), false);
  assert.throws(() => updateField(doc, t.id, "missing", {}), /Field not found/);
});

test("addRelationship validates endpoints and cardinality", () => {
  const doc = emptyDocument();
  const a = addTable(doc, { name: "a" });
  const b = addTable(doc, { name: "b" });
  assert.throws(
    () =>
      addRelationship(doc, {
        startTableId: a.id,
        startFieldId: "nope",
        endTableId: b.id,
        endFieldId: b.fieldIds[0].id,
      }),
    /Start field not found/,
  );
  const r = addRelationship(doc, {
    startTableId: a.id,
    startFieldId: a.fieldIds[0].id,
    endTableId: b.id,
    endFieldId: b.fieldIds[0].id,
    cardinality: "one_to_one",
  });
  updateRelationship(doc, r.id, { cardinality: "many_to_one" });
  assert.equal(doc.references[0].cardinality, "many_to_one");
  assert.throws(
    () => updateRelationship(doc, r.id, { cardinality: "bogus" }),
    /Invalid cardinality/,
  );
  deleteRelationship(doc, r.id);
  assert.equal(doc.references.length, 0);
});

test("areas and notes keep integer ids equal to their index after delete", () => {
  const doc = emptyDocument();
  addArea(doc, { name: "one" });
  addArea(doc, { name: "two" });
  addArea(doc, { name: "three" });
  deleteArea(doc, 0);
  assert.deepEqual(
    doc.areas.map((a) => a.id),
    [0, 1],
  );
  assert.equal(doc.areas[0].name, "two");

  addNote(doc, { title: "n0" });
  addNote(doc, { title: "n1" });
  deleteNote(doc, 0);
  assert.deepEqual(
    doc.notes.map((n) => n.id),
    [0],
  );
  assert.equal(doc.notes[0].title, "n1");
});

test("enums and types are gated on database capability", () => {
  const pg = emptyDocument("postgresql");
  addEnum(pg, { name: "status", values: ["a", "b"] });
  assert.equal(pg.enums.length, 1);
  addType(pg, { name: "addr", fields: [{ name: "city", type: "text" }] });
  assert.equal(pg.types.length, 1);

  const mysql = emptyDocument("mysql");
  assert.throws(() => addEnum(mysql, { name: "x" }), /does not support enums/);
  assert.throws(() => addType(mysql, { name: "y" }), /does not support types/);
});

test("setDatabase validates and drops unsupported enums/types", () => {
  const doc = emptyDocument("postgresql");
  addEnum(doc, { name: "e", values: [] });
  addType(doc, { name: "tp", fields: [] });
  assert.throws(() => setDatabase(doc, "nope"), /Invalid database/);
  setDatabase(doc, "mysql");
  assert.equal(doc.database, "mysql");
  assert.equal(doc.enums, undefined);
  assert.equal(doc.types, undefined);
});

test("importDiagram accepts schema-form and wire-form aliases", () => {
  const doc = emptyDocument();
  importDiagram(doc, {
    database: "generic",
    tables: [{ id: "x", name: "x", x: 0, y: 0, fields: [], comment: "", indices: [], color: "#175e7a" }],
    relationships: [],
    notes: [],
    subjectAreas: [],
  });
  assert.equal(doc.tables.length, 1);
  assert.ok(Array.isArray(doc.references));
  assert.ok(Array.isArray(doc.areas));
});

test("invalid color is rejected", () => {
  const doc = emptyDocument();
  assert.throws(() => addTable(doc, { name: "t", color: "red" }), /Invalid color/);
});
