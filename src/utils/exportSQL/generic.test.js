// GENERIC (database-agnostic) export tests.
//
// A GENERIC diagram has NO importer — it is export-only. The user picks a
// TARGET dialect and drawDB emits DDL through the jsonTo<Target> functions in
// generic.js (ControlPanel.jsx "Export → Source" submenu, wired only for
// DB.GENERIC). This suite:
//   1. drives a GENERIC fixture through each emitter, asserts the expected
//      clauses, and (where the app's parser allows) parses+imports the output
//      back as the target dialect to prove the model survives;
//   2. unit-tests the dbToTypes[DB.GENERIC] checkDefault validators;
//   3. pins the two flagged generic.js bugs (zero-field MSSQL type; Oracle
//      CREATE DOMAIN AS ENUM);
//   4. in a DRAWDB_LIVE_DB-gated block, feeds the emitted DDL to the CURRENT
//      RELEASE of every runnable engine (mysql84 / postgres / mariadb / sqlite)
//      and asserts it is accepted — the current-release check.
//
// Injection/escaping for these emitters is already covered by exporters.test.js
// and is intentionally not duplicated here.
import { describe, it, expect } from "vitest";
import {
  jsonToMySQL,
  jsonToPostgreSQL,
  jsonToSQLite,
  jsonToMariaDB,
  jsonToSQLServer,
  jsonToOracleSQL,
  getTypeString,
} from "./generic";
import { parseAndImport, runLiveDDL, LIVE_DB } from "../sqlTestKit";
import { dbToTypes } from "../../data/datatypes";
import { DB } from "../../data/constants";

// A live engine can take ~10s just to boot (mysql84), well past vitest's 5s
// default; runLiveDDL itself caps at 180s.
const LIVE_TIMEOUT = 190000;

const field = (o) => ({
  id: o.id,
  name: o.name,
  type: o.type,
  size: o.size ?? "",
  notNull: !!o.notNull,
  primary: !!o.primary,
  unique: !!o.unique,
  increment: !!o.increment,
  default: o.default ?? "",
  check: o.check ?? "",
  comment: o.comment ?? "",
  values: o.values ?? [],
});

// The standard GENERIC fixture: two tables, a PK + auto-increment, VARCHAR,
// BOOLEAN, TIMESTAMP, DECIMAL(p,s), a unique index, and a FK with mixed
// ON UPDATE / ON DELETE actions. Built fresh per call so a test cannot mutate
// a shared object. Note: the shape mirrors what ControlPanel passes to the
// emitters — { tables, references, types, database } — with NO `enums` key.
const genericDiagram = () => ({
  database: DB.GENERIC,
  tables: [
    {
      id: 0,
      name: "users",
      comment: "",
      inherits: [],
      uniqueConstraints: [],
      indices: [{ name: "idx_email", unique: true, fields: ["email"] }],
      fields: [
        field({
          id: 0,
          name: "id",
          type: "INT",
          primary: true,
          notNull: true,
          increment: true,
          unique: true,
        }),
        field({ id: 1, name: "username", type: "VARCHAR", size: "255", notNull: true }),
        field({ id: 2, name: "email", type: "VARCHAR", size: "255" }),
        field({ id: 3, name: "active", type: "BOOLEAN", default: "true" }),
        field({ id: 4, name: "created_at", type: "TIMESTAMP" }),
        field({ id: 5, name: "balance", type: "DECIMAL", size: "10,2" }),
      ],
    },
    {
      id: 1,
      name: "posts",
      comment: "",
      inherits: [],
      uniqueConstraints: [],
      indices: [],
      fields: [
        field({
          id: 0,
          name: "id",
          type: "INT",
          primary: true,
          notNull: true,
          increment: true,
          unique: true,
        }),
        field({ id: 1, name: "user_id", type: "INT" }),
        field({ id: 2, name: "title", type: "VARCHAR", size: "255" }),
      ],
    },
  ],
  references: [
    {
      id: 0,
      name: "posts_user_id_fk",
      startTableId: 1,
      startFieldId: 1,
      endTableId: 0,
      endFieldId: 0,
      updateConstraint: "No action",
      deleteConstraint: "Cascade",
    },
  ],
  types: [],
});

// Per-target expectations. `engine` is the runLiveDDL key (null = not runnable
// live here). `reimport` is false where the app's node-sql-parser cannot parse
// the emitter's own output (MariaDB CREATE OR REPLACE TABLE).
const TARGETS = [
  {
    name: "MySQL",
    fn: jsonToMySQL,
    db: DB.MYSQL,
    engine: "mysql",
    reimport: true,
    contains: [
      "CREATE TABLE IF NOT EXISTS `users`",
      "`id` INT NOT NULL AUTO_INCREMENT",
      "`username` VARCHAR(255) NOT NULL",
      "`active` BOOLEAN DEFAULT true",
      "`balance` DECIMAL(10,2)",
      "PRIMARY KEY(`id`)",
      "CREATE UNIQUE INDEX `idx_email`",
      "ADD FOREIGN KEY(`user_id`) REFERENCES `users`(`id`)",
      "ON UPDATE NO ACTION ON DELETE CASCADE",
    ],
  },
  {
    name: "PostgreSQL",
    fn: jsonToPostgreSQL,
    db: DB.POSTGRES,
    engine: "postgres",
    reimport: true,
    contains: [
      'CREATE TABLE IF NOT EXISTS "users"',
      '"id" serial NOT NULL',
      '"username" varchar(255) NOT NULL',
      '"active" boolean DEFAULT true',
      '"created_at" TIMESTAMPTZ',
      '"balance" decimal(10,2)',
      'ADD FOREIGN KEY("user_id") REFERENCES "users"("id")',
      "ON UPDATE NO ACTION ON DELETE CASCADE",
    ],
  },
  {
    name: "SQLite",
    fn: jsonToSQLite,
    db: DB.SQLITE,
    engine: "sqlite",
    reimport: true,
    contains: [
      'CREATE TABLE IF NOT EXISTS "users"',
      '"id" INTEGER NOT NULL',
      '"username" TEXT NOT NULL',
      '"balance" REAL',
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_email"',
      // SQLite emits FKs inline, not as a trailing ALTER TABLE.
      'FOREIGN KEY ("user_id") REFERENCES "users"("id")',
    ],
  },
  {
    name: "MariaDB",
    fn: jsonToMariaDB,
    db: DB.MARIADB,
    engine: "mariadb",
    // node-sql-parser errors on `CREATE OR REPLACE TABLE`, so the app's parser
    // cannot re-import MariaDB generic output; the live engine is the check.
    reimport: false,
    contains: [
      "CREATE OR REPLACE TABLE `users`",
      "`id` INT NOT NULL AUTO_INCREMENT",
      "`balance` DECIMAL(10,2)",
      "ADD FOREIGN KEY(`user_id`) REFERENCES `users`(`id`)",
      "ON UPDATE NO ACTION ON DELETE CASCADE",
    ],
  },
];

describe("GENERIC emitters produce the expected target clauses", () => {
  for (const t of TARGETS) {
    it(`${t.name} emits the expected DDL`, () => {
      const sql = t.fn(genericDiagram());
      for (const clause of t.contains) {
        expect(sql).toContain(clause);
      }
    });
  }
});

describe("GENERIC exports re-import as their target dialect", () => {
  for (const t of TARGETS) {
    if (!t.reimport) {
      // Documented parser gap, not a DDL defect: `CREATE OR REPLACE TABLE` is
      // valid MariaDB but node-sql-parser rejects it, so the model cannot be
      // recovered through the app's import path. Verified live instead.
      it.skip(`${t.name} re-imports (blocked: node-sql-parser cannot parse CREATE OR REPLACE TABLE)`, () => {});
      continue;
    }
    it(`${t.name} export parses back into a 2-table, 1-FK model`, () => {
      const sql = t.fn(genericDiagram());
      const model = parseAndImport(sql, t.db);
      expect(model.tables).toHaveLength(2);
      expect(model.tables.map((tbl) => tbl.name)).toEqual(["users", "posts"]);
      expect(model.relationships).toHaveLength(1);
      const users = model.tables[0];
      expect(users.fields.map((f) => f.name)).toEqual([
        "id",
        "username",
        "email",
        "active",
        "created_at",
        "balance",
      ]);
    });
  }
});

// getTypeString maps the neutral defaultTypes catalog into each dialect. The
// currentDb is always DB.GENERIC for a GENERIC diagram; dbms selects the target.
describe("getTypeString maps GENERIC types per target dialect", () => {
  const cases = [
    // UUID has no native form in most engines.
    ["UUID → MySQL", { type: "UUID" }, DB.MYSQL, "VARCHAR(36)"],
    ["UUID → MSSQL", { type: "UUID" }, DB.MSSQL, "UNIQUEIDENTIFIER"],
    ["UUID → Oracle", { type: "UUID" }, DB.ORACLESQL, "RAW(16)"],
    // Increment integers become the serial family on Postgres.
    ["INT+increment → Postgres", { type: "INT", increment: true }, DB.POSTGRES, "serial"],
    ["SMALLINT+increment → Postgres", { type: "SMALLINT", increment: true }, DB.POSTGRES, "smallserial"],
    ["BIGINT+increment → Postgres", { type: "BIGINT", increment: true }, DB.POSTGRES, "bigserial"],
    // Dialect-specific string / bool / bigint mappings.
    ["VARCHAR → MSSQL", { type: "VARCHAR", size: "255" }, DB.MSSQL, "NVARCHAR(255)"],
    ["VARCHAR → Oracle", { type: "VARCHAR", size: "255" }, DB.ORACLESQL, "VARCHAR2(255)"],
    ["BOOLEAN → MSSQL", { type: "BOOLEAN" }, DB.MSSQL, "BIT"],
    ["BIGINT → Oracle", { type: "BIGINT" }, DB.ORACLESQL, "NUMBER(38,0)"],
    ["TIMESTAMP → Postgres", { type: "TIMESTAMP" }, DB.POSTGRES, "TIMESTAMPTZ"],
  ];
  for (const [label, f, dbms, expected] of cases) {
    it(label, () => {
      expect(getTypeString(field({ id: 0, name: "c", ...f }), DB.GENERIC, dbms)).toBe(
        expected,
      );
    });
  }
});

// dbToTypes[DB.GENERIC] is exactly defaultTypes; these are the validators the
// editor runs on a field's DEFAULT value.
describe("dbToTypes[DB.GENERIC] checkDefault", () => {
  const T = dbToTypes[DB.GENERIC];

  it("INT accepts integers, rejects non-numeric", () => {
    expect(T.INT.checkDefault({ default: "123" })).toBe(true);
    expect(T.INT.checkDefault({ default: "-7" })).toBe(true);
    expect(T.INT.checkDefault({ default: "abc" })).toBe(false);
  });

  it("DECIMAL accepts decimals, rejects non-numeric", () => {
    expect(T.DECIMAL.checkDefault({ default: "1.5" })).toBe(true);
    expect(T.DECIMAL.checkDefault({ default: "x" })).toBe(false);
  });

  it("BOOLEAN accepts true/false/0/1 only", () => {
    for (const v of ["true", "false", "True", "0", "1"]) {
      expect(T.BOOLEAN.checkDefault({ default: v })).toBe(true);
    }
    expect(T.BOOLEAN.checkDefault({ default: "2" })).toBe(false);
    expect(T.BOOLEAN.checkDefault({ default: "yes" })).toBe(false);
  });

  it("VARCHAR enforces the declared size", () => {
    expect(T.VARCHAR.checkDefault({ default: "hi", size: 255 })).toBe(true);
    expect(T.VARCHAR.checkDefault({ default: "abcdef", size: 3 })).toBe(false);
  });

  it("TIMESTAMP accepts CURRENT_TIMESTAMP and in-range dates", () => {
    expect(T.TIMESTAMP.checkDefault({ default: "CURRENT_TIMESTAMP" })).toBe(true);
    expect(T.TIMESTAMP.checkDefault({ default: "2020-01-01 00:00:00" })).toBe(true);
    // Year outside the TIMESTAMP 1970–2038 window.
    expect(T.TIMESTAMP.checkDefault({ default: "1000-01-01 00:00:00" })).toBe(false);
    expect(T.TIMESTAMP.checkDefault({ default: "not a date" })).toBe(false);
  });

  it("ENUM accepts only a declared member", () => {
    expect(T.ENUM.checkDefault({ default: "a", values: ["a", "b"] })).toBe(true);
    expect(T.ENUM.checkDefault({ default: "z", values: ["a", "b"] })).toBe(false);
  });

  // Flagged bug (report §5, datatypes.js:240 — file off-limits to this effort):
  // schemas.js permits a boolean/number DEFAULT, but the string validators call
  // .toLowerCase()/.length on it and throw. Documented here; not fixed (shared
  // file). getIssues() would crash on such a field.
  it("throws on a non-string default (known datatypes.js bug — flagged, not fixed)", () => {
    expect(() => T.BOOLEAN.checkDefault({ default: true })).toThrow(
      /toLowerCase is not a function/,
    );
  });
});

// ---- Flagged generic.js bugs -------------------------------------------------

describe("jsonToSQLServer zero-field composite type (generic.js:563)", () => {
  // The guard read `type.fields.length < 0` (never true), so a zero-field type
  // dereferenced fields[0] and threw. Fixed this effort to `=== 0`. The emitted
  // `CREATE TYPE [t] FROM ;` is still not valid T-SQL, but the crash is gone
  // (SQLServer is not a live engine here, so full validity is out of scope).
  const zeroFieldType = {
    database: DB.GENERIC,
    tables: [],
    references: [],
    types: [{ name: "empty_t", comment: "", fields: [] }],
  };

  it("does not throw on an empty type field list", () => {
    expect(() => jsonToSQLServer(zeroFieldType)).not.toThrow();
  });

  it("emits an (empty) CREATE TYPE ... FROM for it", () => {
    expect(jsonToSQLServer(zeroFieldType)).toContain("CREATE TYPE [empty_t] FROM ;");
  });
});

describe("jsonToOracleSQL emits invalid CREATE DOMAIN AS ENUM (generic.js:650)", () => {
  // FLAGGED, NOT FIXED: Oracle has no `CREATE DOMAIN ... AS ENUM`, so a GENERIC
  // diagram with an ENUM field exported to Oracle produces DDL Oracle rejects.
  // Oracle export is Beta and is not runnable live in this kit; fixing it needs
  // a non-trivial rewrite of the Oracle type-emission path. This test documents
  // the current (buggy) output so a future fix flips it deliberately.
  it("currently produces the unsupported construct", () => {
    const d = {
      database: DB.GENERIC,
      references: [],
      types: [],
      tables: [
        {
          id: 0,
          name: "t",
          comment: "",
          inherits: [],
          uniqueConstraints: [],
          indices: [],
          fields: [
            field({ id: 0, name: "id", type: "INT", primary: true, notNull: true }),
            field({ id: 1, name: "status", type: "ENUM", values: ["a", "b"] }),
          ],
        },
      ],
    };
    // Known-bad: no Oracle release accepts CREATE DOMAIN ... AS ENUM.
    expect(jsonToOracleSQL(d)).toContain('CREATE DOMAIN "status_t" AS ENUM');
  });
});

// ---- Live current-release acceptance ----------------------------------------

(LIVE_DB ? describe : describe.skip)("live generic exports", () => {
  for (const t of TARGETS) {
    it(
      `${t.name} DDL is accepted by the current ${t.engine} release`,
      () => {
        const sql = t.fn(genericDiagram());
        const result = runLiveDDL(t.engine, sql);
        expect(result.ok, result.error).toBe(true);
      },
      LIVE_TIMEOUT,
    );
  }

  // The MySQL/MariaDB composite-type path emits a JSON column guarded by a
  // JSON_SCHEMA_VALID CHECK. mysql84 supports it; MariaDB only since 11.1.1, so
  // this is exercised live through MySQL only.
  it(
    "MySQL accepts a composite type as JSON + JSON_SCHEMA_VALID CHECK",
    () => {
      const d = {
        database: DB.GENERIC,
        references: [],
        types: [
          {
            name: "address",
            comment: "",
            fields: [
              { name: "street", type: "VARCHAR" },
              { name: "zip", type: "INT" },
            ],
          },
        ],
        tables: [
          {
            id: 0,
            name: "people",
            comment: "",
            inherits: [],
            uniqueConstraints: [],
            indices: [],
            fields: [
              field({ id: 0, name: "id", type: "INT", primary: true, notNull: true, increment: true }),
              field({ id: 1, name: "home", type: "address" }),
            ],
          },
        ],
      };
      const sql = jsonToMySQL(d);
      expect(sql).toContain("JSON_SCHEMA_VALID(");
      const result = runLiveDDL("mysql", sql);
      expect(result.ok, result.error).toBe(true);
    },
    LIVE_TIMEOUT,
  );
});
