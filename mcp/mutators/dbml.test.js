import assert from "node:assert/strict";
import test from "node:test";
import { emptyDocument } from "./index.js";
import { applyDbml, exportDbml } from "./dbml.js";

const SAMPLE = `
Table users {
  id integer [pk, increment]
  email varchar [unique, not null]
  status status_enum
}

Table posts {
  id integer [pk]
  author_id integer
}

Ref: posts.author_id > users.id

Enum status_enum {
  active
  banned
}
`;

test("applyDbml imports tables, relationships, and enums", () => {
  const doc = emptyDocument("postgresql");
  const summary = applyDbml(doc, SAMPLE);
  assert.equal(summary.tables, 2);
  assert.equal(summary.references, 1);
  const users = doc.tables.find((t) => t.name === "users");
  assert.ok(users);
  assert.equal(users.fields.find((f) => f.name === "id").primary, true);
  assert.equal(users.fields.find((f) => f.name === "id").increment, true);
  assert.equal(users.fields.find((f) => f.name === "email").unique, true);
  // Positions are arranged, not all-zero.
  assert.ok(doc.tables.some((t) => t.x !== 0 || t.y !== 0) || doc.tables.length === 1);
  // Relationship endpoints resolve to real ids.
  const rel = doc.references[0];
  assert.ok(doc.tables.find((t) => t.id === rel.startTableId));
  // Enum imported (postgres supports enums).
  assert.equal(doc.enums.length, 1);
  assert.deepEqual(doc.enums[0].values, ["active", "banned"]);
});

test("applyDbml requires a non-empty string", () => {
  const doc = emptyDocument();
  assert.throws(() => applyDbml(doc, ""), /DBML string is required/);
});

test("exportDbml round-trips through applyDbml", () => {
  const doc = emptyDocument("postgresql");
  applyDbml(doc, SAMPLE);
  const dbml = exportDbml(doc);
  assert.match(dbml, /Table users \{/);
  assert.match(dbml, /Ref: posts\.author_id > users\.id/);
  assert.match(dbml, /Enum status_enum \{/);

  // Re-import the exported DBML into a fresh document; structure survives.
  const doc2 = emptyDocument("postgresql");
  const summary = applyDbml(doc2, dbml);
  assert.equal(summary.tables, 2);
  assert.equal(summary.references, 1);
});

test("exportDbml quotes identifiers that need it", () => {
  const doc = emptyDocument();
  doc.tables = [
    {
      id: "t1",
      name: "order items",
      x: 0,
      y: 0,
      comment: "",
      indices: [],
      color: "#175e7a",
      fields: [
        {
          id: "f1",
          name: "id",
          type: "INT",
          default: "",
          check: "",
          primary: true,
          unique: false,
          notNull: true,
          increment: false,
          comment: "",
        },
      ],
    },
  ];
  const dbml = exportDbml(doc);
  assert.match(dbml, /Table "order items" \{/);
});
