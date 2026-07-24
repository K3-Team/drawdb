import assert from "node:assert/strict";
import test from "node:test";
import { emptyDocument, exportSql } from "./index.js";
import { applyDbml } from "./dbml.js";

const SAMPLE = `
Table users {
  id integer [pk, increment]
  email varchar [unique, not null]
}
Table posts {
  id integer [pk]
  author_id integer
}
Ref: posts.author_id > users.id
`;

test("exportSql emits DDL for a concrete dialect", () => {
  const doc = emptyDocument("postgresql");
  applyDbml(doc, SAMPLE);
  const sql = exportSql(doc);
  assert.match(sql, /CREATE TABLE/i);
  assert.match(sql, /"users"/);
  assert.match(sql, /"posts"/);
  // The relationship becomes a foreign key.
  assert.match(sql, /FOREIGN KEY/i);
});

test("exportSql works across dialects", () => {
  // MariaDB uses "CREATE OR REPLACE TABLE"; others "CREATE TABLE".
  const createTable = /CREATE\s+(OR REPLACE\s+)?TABLE/i;
  for (const database of ["mysql", "sqlite", "mariadb", "transactsql", "oraclesql"]) {
    const doc = emptyDocument(database);
    applyDbml(doc, SAMPLE);
    const sql = exportSql(doc);
    assert.match(sql, createTable, `${database} should emit a CREATE TABLE`);
  }
});

test("exportSql refuses the generic database with a clear message", () => {
  const doc = emptyDocument("generic");
  applyDbml(doc, SAMPLE);
  assert.throws(() => exportSql(doc), /generic.*database has no SQL dialect/i);
});

test("exportSql reuses the client's sqlSafety escaping", () => {
  // A hostile table name that could break out of a quoted identifier must be
  // neutralised by the shared exporter, not passed through raw.
  const doc = emptyDocument("mysql");
  doc.tables = [
    {
      id: "t1",
      name: "ev`il",
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
          increment: true,
          comment: "",
        },
      ],
    },
  ];
  // Either the identifier is safely escaped/doubled, or the exporter rejects
  // it — in no case does a bare closing backtick survive unescaped.
  let sql;
  try {
    sql = exportSql(doc);
  } catch {
    return; // rejected outright is an acceptable safe outcome
  }
  assert.doesNotMatch(sql, /`ev`il`/, "raw backtick must not break the identifier");
});
