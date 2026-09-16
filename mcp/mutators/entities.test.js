import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyDocument,
  addTable,
  deleteTable,
  getTable,
  addField,
  updateField,
  deleteField,
  addRelationship,
  updateRelationship,
  deleteRelationship,
  addSpecialization,
  updateSpecialization,
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

function hierarchy() {
  const doc = emptyDocument();
  const user = addTable(doc, { name: "user" });
  const customer = addTable(doc, { name: "customer" });
  const seller = addTable(doc, { name: "seller" });
  const typeField = addField(doc, user.id, { name: "user_type", type: "varchar" });
  return { doc, user, customer, seller, typeField };
}

test("addRelationship with kind subtype forces 1:1, cascade and is_a name", () => {
  const { doc, user, customer } = hierarchy();
  const r = addRelationship(doc, {
    startTableId: customer.id,
    startFieldId: customer.fieldIds[0].id,
    endTableId: user.id,
    endFieldId: user.fieldIds[0].id,
    kind: "subtype",
    cardinality: "many_to_one",
    subtype: { group: "role", disjoint: false, total: true },
  });
  const rel = doc.references.find((x) => x.id === r.id);
  assert.equal(rel.kind, "subtype");
  assert.equal(rel.cardinality, "one_to_one");
  assert.equal(rel.deleteConstraint, "Cascade");
  assert.equal(rel.name, "is_a_customer_user");
  assert.deepEqual(rel.subtype, { group: "role", disjoint: false, total: true });
});

test("addRelationship rejects a bad kind, a bad discriminator and bad participation", () => {
  const { doc, user, customer } = hierarchy();
  const base = {
    startTableId: customer.id,
    startFieldId: customer.fieldIds[0].id,
    endTableId: user.id,
    endFieldId: user.fieldIds[0].id,
  };
  assert.throws(() => addRelationship(doc, { ...base, kind: "weird" }), /Invalid kind/);
  assert.throws(
    () =>
      addRelationship(doc, {
        ...base,
        kind: "subtype",
        subtype: { group: "g", disjoint: true, total: true, discriminatorFieldId: "nope" },
      }),
    /Discriminator field not found/,
  );
  assert.throws(
    () => addRelationship(doc, { ...base, participation: { end: "maybe" } }),
    /Invalid participation/,
  );
});

test("addRelationship stores fk participation and updateRelationship can clear it", () => {
  const { doc, user, customer } = hierarchy();
  const r = addRelationship(doc, {
    startTableId: customer.id,
    startFieldId: customer.fieldIds[0].id,
    endTableId: user.id,
    endFieldId: user.fieldIds[0].id,
    participation: { end: "mandatory" },
  });
  assert.deepEqual(doc.references[0].participation, { end: "mandatory" });
  updateRelationship(doc, r.id, { participation: null });
  assert.equal(doc.references[0].participation, undefined);
});

test("updateRelationship syncs subtype constraints across siblings", () => {
  const { doc, user, customer, seller, typeField } = hierarchy();
  const a = addRelationship(doc, {
    startTableId: customer.id,
    startFieldId: customer.fieldIds[0].id,
    endTableId: user.id,
    endFieldId: user.fieldIds[0].id,
    kind: "subtype",
    subtype: { group: "role", disjoint: false, total: true },
  });
  const b = addRelationship(doc, {
    startTableId: seller.id,
    startFieldId: seller.fieldIds[0].id,
    endTableId: user.id,
    endFieldId: user.fieldIds[0].id,
    kind: "subtype",
    subtype: { group: "role", disjoint: false, total: true },
  });
  updateRelationship(doc, a.id, {
    subtype: { group: "role", disjoint: true, total: false, discriminatorFieldId: typeField.id },
  });
  const relB = doc.references.find((x) => x.id === b.id);
  assert.deepEqual(relB.subtype, {
    group: "role",
    disjoint: true,
    total: false,
    discriminatorFieldId: typeField.id,
  });
  // switching a subtype back to fk drops the subtype block; absent kind means fk (same as every pre-feature relationship), so kind is removed
  updateRelationship(doc, a.id, { kind: "fk" });
  const relA = doc.references.find((x) => x.id === a.id);
  assert.equal(relA.kind, undefined);
  assert.equal(relA.subtype, undefined);
  // and a subtype link cannot be given a non-1:1 cardinality
  assert.throws(
    () => updateRelationship(doc, b.id, { cardinality: "many_to_one" }),
    /subtype links are always one_to_one/,
  );
});

test("addSpecialization creates one sibling link per subtype table", () => {
  const { doc, user, customer, seller, typeField } = hierarchy();
  const res = addSpecialization(doc, {
    supertypeTableId: user.id,
    subtypeTableIds: [customer.id, seller.id],
    group: "role",
    disjoint: false,
    total: true,
    discriminatorFieldId: typeField.id,
  });
  assert.equal(res.ids.length, 2);
  assert.equal(doc.references.length, 2);
  for (const rel of doc.references) {
    assert.equal(rel.kind, "subtype");
    assert.equal(rel.cardinality, "one_to_one");
    assert.equal(rel.endTableId, user.id);
    assert.equal(rel.endFieldId, user.fieldIds[0].id);
    assert.equal(rel.subtype.group, "role");
    assert.equal(rel.subtype.discriminatorFieldId, typeField.id);
  }
  assert.equal(doc.references[0].startTableId, customer.id);
  assert.equal(doc.references[0].startFieldId, customer.fieldIds[0].id);
  assert.equal(doc.references[0].name, "is_a_customer_user");
});

test("addSpecialization requires a primary key on every table", () => {
  const { doc, user, customer } = hierarchy();
  updateField(doc, customer.id, customer.fieldIds[0].id, { primary: false });
  assert.throws(
    () =>
      addSpecialization(doc, {
        supertypeTableId: user.id,
        subtypeTableIds: [customer.id],
        group: "role",
      }),
    /has no primary key/,
  );
});

test("updateSpecialization rewrites every sibling and errors on unknown group", () => {
  const { doc, user, customer, seller } = hierarchy();
  addSpecialization(doc, {
    supertypeTableId: user.id,
    subtypeTableIds: [customer.id, seller.id],
    group: "role",
    disjoint: false,
    total: true,
  });
  const res = updateSpecialization(doc, {
    supertypeTableId: user.id,
    group: "role",
    updates: { disjoint: true },
  });
  assert.equal(res.ids.length, 2);
  for (const rel of doc.references) {
    assert.equal(rel.subtype.disjoint, true);
    assert.equal(rel.subtype.total, true);
  }
  assert.throws(
    () => updateSpecialization(doc, { supertypeTableId: user.id, group: "nope", updates: {} }),
    /No specialisation/,
  );
});
