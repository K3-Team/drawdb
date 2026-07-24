import { describe, it, expect } from "vitest";
import { parseAndImport } from "../sqlTestKit";
import { DB, Cardinality } from "../../data/constants";

// Import feature-matrix for the SQLite CREATE path (fromSQLite). Each fixture is
// real DDL pushed through the exact flow Modal.jsx uses:
//   normalizeSQLForParser -> node-sql-parser (sqlite) -> importSQL(fromSQLite).
//
// node-sql-parser's sqlite grammar accepts only a fixed type vocabulary
// (INT/INTEGER/BIGINT/SMALLINT/TINYINT, REAL/FLOAT/DOUBLE, NUMERIC/DECIMAL,
// CHAR/CHARACTER[no size]/VARCHAR/TEXT, DATE/DATETIME/TIME/TIMESTAMP, BLOB,
// BOOLEAN, JSON, BIT, ...). Arbitrary/unknown type names (NVARCHAR, MEDIUMINT,
// "UNSIGNED BIG INT", user types) FAIL TO PARSE, so the affinity map entries for
// those are unreachable via this path and are not asserted here.

const imp = (sql) => parseAndImport(sql, DB.SQLITE);
const table = (d, name) => d.tables.find((t) => t.name === name);
const field = (t, name) => t.fields.find((f) => f.name === name);

describe("fromSQLite: column constraints", () => {
  it("captures NOT NULL", () => {
    const t = table(imp(`CREATE TABLE t (a TEXT NOT NULL, b TEXT);`), "t");
    expect(field(t, "a").notNull).toBe(true);
    expect(field(t, "b").notNull).toBe(false);
  });

  it("captures inline UNIQUE", () => {
    const t = table(imp(`CREATE TABLE t (email TEXT UNIQUE, name TEXT);`), "t");
    expect(field(t, "email").unique).toBe(true);
    expect(field(t, "name").unique).toBe(false);
  });

  it("captures DEFAULT for numeric and string columns", () => {
    const t = table(
      imp(`CREATE TABLE t (n INTEGER DEFAULT 5, s VARCHAR(50) DEFAULT 'x');`),
      "t",
    );
    expect(field(t, "n").default).toBe("5");
    expect(field(t, "s").default).toBe("x");
    expect(field(t, "s").size).toBe(50);
  });

  it("captures a CHECK expression", () => {
    const t = table(imp(`CREATE TABLE t (age INTEGER CHECK(age >= 0));`), "t");
    // buildSQLFromAST re-quotes the column identifier for SQLite (").
    expect(field(t, "age").check).toBe('"age" >= 0');
  });
});

describe("fromSQLite: primary keys and autoincrement", () => {
  it("INTEGER PRIMARY KEY AUTOINCREMENT sets primary + increment", () => {
    const t = table(
      imp(`CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, x TEXT);`),
      "t",
    );
    expect(field(t, "id").primary).toBe(true);
    expect(field(t, "id").increment).toBe(true);
  });

  it("INTEGER PRIMARY KEY without AUTOINCREMENT is primary but not increment", () => {
    const t = table(imp(`CREATE TABLE t (id INTEGER PRIMARY KEY);`), "t");
    expect(field(t, "id").primary).toBe(true);
    expect(field(t, "id").increment).toBe(false);
  });

  it("table-level composite PRIMARY KEY marks every member primary", () => {
    const t = table(
      imp(`CREATE TABLE t (a INTEGER, b INTEGER, PRIMARY KEY(a, b));`),
      "t",
    );
    expect(field(t, "a").primary).toBe(true);
    expect(field(t, "b").primary).toBe(true);
  });
});

describe("fromSQLite: indices and unique constraints", () => {
  it("attaches a CREATE INDEX to its table with a plain name and fields", () => {
    // Regression: fromSQLite previously stored e.index (a {schema,name} object)
    // as the index name and read f.column (undefined) for fields, yielding
    // name:{...} and fields:[null].
    const t = table(
      imp(`CREATE TABLE t (email TEXT);
CREATE INDEX ix_email ON t (email);`),
      "t",
    );
    expect(t.indices).toHaveLength(1);
    expect(t.indices[0].name).toBe("ix_email");
    expect(t.indices[0].unique).toBe(false);
    expect(t.indices[0].fields).toEqual(["email"]);
  });

  it("captures a UNIQUE index as unique", () => {
    const t = table(
      imp(`CREATE TABLE t (a INTEGER, b INTEGER);
CREATE UNIQUE INDEX ix_ab ON t (a, b);`),
      "t",
    );
    expect(t.indices[0].unique).toBe(true);
    expect(t.indices[0].fields).toEqual(["a", "b"]);
  });

  it("captures a table-level UNIQUE constraint", () => {
    const t = table(
      imp(`CREATE TABLE t (a INTEGER, b INTEGER, CONSTRAINT uq UNIQUE(a, b));`),
      "t",
    );
    expect(t.uniqueConstraints).toHaveLength(1);
    expect(t.uniqueConstraints[0].name).toBe("uq");
    expect(t.uniqueConstraints[0].fields).toEqual(["a", "b"]);
  });
});

describe("fromSQLite: foreign keys", () => {
  it("extracts an inline REFERENCES with ON DELETE action", () => {
    const d = imp(`CREATE TABLE u (id INTEGER PRIMARY KEY);
CREATE TABLE p (id INTEGER PRIMARY KEY, uid INTEGER REFERENCES u(id) ON DELETE CASCADE);`);
    expect(d.relationships).toHaveLength(1);
    const rel = d.relationships[0];
    expect(rel.startTableId).toBe(table(d, "p").id);
    expect(rel.endTableId).toBe(table(d, "u").id);
    expect(rel.deleteConstraint).toBe("Cascade");
    expect(rel.updateConstraint).toBe("No action");
    expect(rel.cardinality).toBe(Cardinality.MANY_TO_ONE);
  });

  it("a UNIQUE FK column yields a one-to-one cardinality", () => {
    const d = imp(`CREATE TABLE u (id INTEGER PRIMARY KEY);
CREATE TABLE p (uid INTEGER UNIQUE REFERENCES u(id));`);
    expect(d.relationships[0].cardinality).toBe(Cardinality.ONE_TO_ONE);
  });

  it("extracts a composite FOREIGN KEY over two column pairs", () => {
    const d = imp(`CREATE TABLE u (a INTEGER, b INTEGER, PRIMARY KEY(a, b));
CREATE TABLE p (x INTEGER, y INTEGER, FOREIGN KEY(x, y) REFERENCES u(a, b));`);
    expect(d.relationships).toHaveLength(1);
    expect(d.relationships[0].fields).toHaveLength(2);
  });
});

describe("fromSQLite: type affinity", () => {
  // fromSQLite maps parser types not present in the SQLite datatype catalog
  // through the affinity Proxy (fallback -> BLOB).
  const affinityOf = (declared) =>
    field(table(imp(`CREATE TABLE t (c ${declared});`), "t"), "c").type;

  it("keeps catalog types as-is", () => {
    expect(affinityOf("INTEGER")).toBe("INTEGER");
    expect(affinityOf("TEXT")).toBe("TEXT");
    expect(affinityOf("REAL")).toBe("REAL");
    expect(affinityOf("NUMERIC")).toBe("NUMERIC");
    expect(affinityOf("BOOLEAN")).toBe("BOOLEAN");
  });

  it("maps integer-family aliases to INTEGER", () => {
    expect(affinityOf("INT")).toBe("INTEGER");
    expect(affinityOf("BIGINT")).toBe("INTEGER");
    expect(affinityOf("SMALLINT")).toBe("INTEGER");
    expect(affinityOf("TINYINT")).toBe("INTEGER");
  });

  it("maps floating-point aliases to REAL", () => {
    expect(affinityOf("DOUBLE")).toBe("REAL");
    expect(affinityOf("FLOAT")).toBe("REAL");
  });

  it("falls back to BLOB for aliases absent from the affinity map", () => {
    // CHAR/DECIMAL/JSON are accepted by the parser but are neither catalog
    // types nor keyed in the affinity map, so they hit the Proxy's BLOB default.
    expect(affinityOf("CHAR")).toBe("BLOB");
    expect(affinityOf("DECIMAL")).toBe("BLOB");
    expect(affinityOf("JSON")).toBe("BLOB");
  });
});

describe("fromSQLite: comments", () => {
  it("tolerates leading line and block comments", () => {
    const d = imp(`-- a line comment
/* a block comment */
CREATE TABLE t (id INTEGER);`);
    expect(table(d, "t")).toBeTruthy();
  });
});
