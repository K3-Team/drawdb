import { describe, it, expect } from "vitest";
import { toMySQL } from "./mysql";
import { roundTrip, LIVE_DB, runLiveDDL } from "../sqlTestKit";
import { generateMigrationSQL } from "../migrations/diffToSQL";
import { dbToTypes } from "../../data/datatypes";
import { DB } from "../../data/constants";

// --- fixture factories -----------------------------------------------------

let nextId = 1;
const mkField = (over = {}) => ({
  id: nextId++,
  name: "col",
  type: "INTEGER",
  size: "",
  notNull: false,
  primary: false,
  unique: false,
  increment: false,
  unsigned: false,
  default: "",
  check: "",
  comment: "",
  values: [],
  ...over,
});

const mkTable = (over = {}) => ({
  id: nextId++,
  name: "t",
  comment: "",
  indices: [],
  uniqueConstraints: [],
  fields: [],
  ...over,
});

const mkDiagram = (tables, references = []) => ({
  database: DB.MYSQL,
  tables,
  references,
  enums: [],
  types: [],
});

// ---------------------------------------------------------------------------
// (a) Export feature assertions — toMySQL(diagram) text.
// ---------------------------------------------------------------------------

describe("toMySQL — CREATE TABLE feature assertions", () => {
  it("backtick-quotes table and column identifiers", () => {
    const sql = toMySQL(
      mkDiagram([mkTable({ name: "users", fields: [mkField({ name: "id" })] })]),
    );
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `users`");
    expect(sql).toContain("`id`");
  });

  it("emits NOT NULL, DEFAULT and a column COMMENT", () => {
    const sql = toMySQL(
      mkDiagram([
        mkTable({
          fields: [
            mkField({
              name: "name",
              type: "VARCHAR",
              size: 100,
              notNull: true,
              default: "anon",
              comment: "display name",
            }),
          ],
        }),
      ]),
    );
    expect(sql).toContain("`name` VARCHAR(100) NOT NULL DEFAULT 'anon'");
    expect(sql).toContain("COMMENT 'display name'");
  });

  it("emits AUTO_INCREMENT and a PRIMARY KEY clause", () => {
    const sql = toMySQL(
      mkDiagram([
        mkTable({
          fields: [
            mkField({ name: "id", type: "INTEGER", notNull: true, primary: true, increment: true }),
          ],
        }),
      ]),
    );
    expect(sql).toContain("AUTO_INCREMENT");
    expect(sql).toContain("PRIMARY KEY(`id`)");
  });

  it("emits UNSIGNED for a signed numeric type", () => {
    const sql = toMySQL(
      mkDiagram([
        mkTable({ fields: [mkField({ name: "n", type: "INTEGER", unsigned: true })] }),
      ]),
    );
    expect(sql).toContain("`n` INTEGER UNSIGNED");
  });

  it("does not emit UNSIGNED when the flag is off", () => {
    const sql = toMySQL(
      mkDiagram([
        mkTable({ fields: [mkField({ name: "n", type: "INTEGER", unsigned: false })] }),
      ]),
    );
    expect(sql).not.toContain("UNSIGNED");
  });

  it("emits ENUM('..') with quoted members", () => {
    const sql = toMySQL(
      mkDiagram([
        mkTable({
          fields: [mkField({ name: "role", type: "ENUM", values: ["admin", "user"] })],
        }),
      ]),
    );
    expect(sql).toContain("`role` ENUM('admin', 'user')");
  });

  it("emits SET('..') with quoted members", () => {
    const sql = toMySQL(
      mkDiagram([
        mkTable({
          fields: [mkField({ name: "tags", type: "SET", values: ["x", "y"] })],
        }),
      ]),
    );
    expect(sql).toContain("`tags` SET('x', 'y')");
  });

  it("emits an inline CHECK for a type that supports it", () => {
    const sql = toMySQL(
      mkDiagram([
        mkTable({ fields: [mkField({ name: "age", type: "INTEGER", check: "age >= 0" })] }),
      ]),
    );
    expect(sql).toContain("CHECK(age >= 0)");
  });

  it("drops a CHECK on a JSON column (hasCheck:false)", () => {
    const sql = toMySQL(
      mkDiagram([
        mkTable({ fields: [mkField({ name: "doc", type: "JSON", check: "json_valid(doc)" })] }),
      ]),
    );
    expect(sql).not.toContain("CHECK");
  });

  it("emits an inline UNIQUE column", () => {
    const sql = toMySQL(
      mkDiagram([
        mkTable({ fields: [mkField({ name: "email", type: "VARCHAR", size: 255, unique: true })] }),
      ]),
    );
    expect(sql).toContain("`email` VARCHAR(255) UNIQUE");
  });

  it("emits a composite PRIMARY KEY clause", () => {
    const sql = toMySQL(
      mkDiagram([
        mkTable({
          fields: [
            mkField({ name: "a", type: "INTEGER", primary: true }),
            mkField({ name: "b", type: "INTEGER", primary: true }),
          ],
        }),
      ]),
    );
    expect(sql).toContain("PRIMARY KEY(`a`, `b`)");
  });

  it("emits a table-level UNIQUE constraint", () => {
    const sql = toMySQL(
      mkDiagram([
        mkTable({
          uniqueConstraints: [{ id: 0, name: "uq_ab", fields: ["a", "b"] }],
          fields: [
            mkField({ name: "a", type: "INTEGER" }),
            mkField({ name: "b", type: "INTEGER" }),
          ],
        }),
      ]),
    );
    expect(sql).toContain("CONSTRAINT `uq_ab` UNIQUE (`a`, `b`)");
  });

  it("emits a table COMMENT", () => {
    const sql = toMySQL(
      mkDiagram([
        mkTable({ name: "users", comment: "the users", fields: [mkField({ name: "id" })] }),
      ]),
    );
    expect(sql).toContain(") COMMENT='the users';");
  });

  it("emits CREATE INDEX statements", () => {
    const sql = toMySQL(
      mkDiagram([
        mkTable({
          name: "t",
          indices: [{ id: 0, name: "idx_a", unique: false, fields: ["a"] }],
          fields: [mkField({ name: "a", type: "INTEGER" })],
        }),
      ]),
    );
    expect(sql).toContain("CREATE INDEX `idx_a`");
    expect(sql).toContain("ON `t` (`a`)");
  });

  it("emits a UNIQUE index", () => {
    const sql = toMySQL(
      mkDiagram([
        mkTable({
          name: "t",
          indices: [{ id: 0, name: "idx_a", unique: true, fields: ["a"] }],
          fields: [mkField({ name: "a", type: "INTEGER" })],
        }),
      ]),
    );
    expect(sql).toContain("CREATE UNIQUE INDEX `idx_a`");
  });

  it("emits an ALTER TABLE ADD FOREIGN KEY for a reference", () => {
    const users = mkTable({ name: "users", fields: [mkField({ name: "id", type: "INTEGER", primary: true })] });
    const posts = mkTable({
      name: "posts",
      fields: [
        mkField({ name: "id", type: "INTEGER", primary: true }),
        mkField({ name: "author_id", type: "INTEGER" }),
      ],
    });
    const ref = {
      id: 1,
      startTableId: posts.id,
      endTableId: users.id,
      startFieldId: posts.fields[1].id,
      endFieldId: users.fields[0].id,
      fields: [{ startFieldId: posts.fields[1].id, endFieldId: users.fields[0].id }],
      updateConstraint: "No action",
      deleteConstraint: "Cascade",
    };
    const sql = toMySQL(mkDiagram([users, posts], [ref]));
    expect(sql).toContain("ALTER TABLE `posts`");
    expect(sql).toContain("ADD FOREIGN KEY(`author_id`) REFERENCES `users`(`id`)");
    expect(sql).toContain("ON DELETE CASCADE");
  });

  it("doubles an embedded backtick in an identifier", () => {
    const sql = toMySQL(
      mkDiagram([mkTable({ name: "we`ird", fields: [mkField({ name: "id" })] })]),
    );
    expect(sql).toContain("`we``ird`");
  });
});

// ---------------------------------------------------------------------------
// (b) Round-trip: diagram -> SQL -> parse -> diagram.
// ---------------------------------------------------------------------------

describe("toMySQL — round trip", () => {
  it("preserves a feature-rich table through export and re-import", () => {
    const diagram = mkDiagram([
      mkTable({
        name: "users",
        comment: "user table",
        indices: [{ id: 0, name: "idx_role", unique: false, fields: ["role"] }],
        fields: [
          mkField({ name: "id", type: "INTEGER", notNull: true, primary: true, increment: true, unsigned: true }),
          mkField({ name: "role", type: "ENUM", notNull: true, default: "a", values: ["a", "b", "c"] }),
          mkField({ name: "score", type: "INTEGER", default: "0", check: "score >= 0", comment: "the score" }),
          mkField({ name: "tags", type: "SET", values: ["x", "y"] }),
          mkField({ name: "email", type: "VARCHAR", size: 255, unique: true }),
        ],
      }),
    ]);
    const { imported } = roundTrip(diagram);
    const t = imported.tables.find((x) => x.name === "users");
    expect(t).toBeTruthy();
    expect(t.comment).toBe("user table");

    const f = (n) => t.fields.find((x) => x.name === n);
    expect(f("id").type).toBe("INTEGER");
    expect(f("id").primary).toBe(true);
    expect(f("id").increment).toBe(true);
    expect(f("id").unsigned).toBe(true);
    expect(f("role").type).toBe("ENUM");
    expect(f("role").values).toEqual(["a", "b", "c"]);
    expect(f("role").default).toBe("a");
    expect(f("score").default).toBe("0");
    expect(f("score").comment).toBe("the score");
    expect(f("tags").type).toBe("SET");
    expect(f("tags").values).toEqual(["x", "y"]);
    expect(f("email").unique).toBe(true);
    expect(f("email").size).toBe(255);

    expect(t.indices.length).toBe(1);
    expect(t.indices[0].fields).toEqual(["role"]);
  });

  it("preserves a foreign-key relationship through a round trip", () => {
    const users = mkTable({ name: "users", fields: [mkField({ name: "id", type: "INTEGER", primary: true })] });
    const posts = mkTable({
      name: "posts",
      fields: [
        mkField({ name: "id", type: "INTEGER", primary: true }),
        mkField({ name: "author_id", type: "INTEGER" }),
      ],
    });
    const ref = {
      id: 1,
      startTableId: posts.id,
      endTableId: users.id,
      startFieldId: posts.fields[1].id,
      endFieldId: users.fields[0].id,
      fields: [{ startFieldId: posts.fields[1].id, endFieldId: users.fields[0].id }],
      updateConstraint: "No action",
      deleteConstraint: "Cascade",
    };
    const { imported } = roundTrip(mkDiagram([users, posts], [ref]));
    expect(imported.relationships.length).toBe(1);
    expect(imported.relationships[0].deleteConstraint).toBe("Cascade");
  });
});

// ---------------------------------------------------------------------------
// (c) dbToTypes[DB.MYSQL] checkDefault rules.
// ---------------------------------------------------------------------------

describe("dbToTypes[MYSQL] checkDefault", () => {
  const check = (type, field) => dbToTypes[DB.MYSQL][type].checkDefault(field);

  it("INTEGER accepts integers, rejects non-integers", () => {
    expect(check("INTEGER", { default: "42" })).toBe(true);
    expect(check("INTEGER", { default: "-7" })).toBe(true);
    expect(check("INTEGER", { default: "3.14" })).toBe(false);
    expect(check("INTEGER", { default: "abc" })).toBe(false);
  });

  it("DECIMAL accepts decimals", () => {
    expect(check("DECIMAL", { default: "3.14" })).toBe(true);
    expect(check("DECIMAL", { default: "10" })).toBe(true);
    expect(check("DECIMAL", { default: "x" })).toBe(false);
  });

  it("VARCHAR enforces size, allowing for surrounding quotes", () => {
    expect(check("VARCHAR", { default: "hello", size: 10 })).toBe(true);
    expect(check("VARCHAR", { default: "toolong", size: 3 })).toBe(false);
    expect(check("VARCHAR", { default: "'hi'", size: 2 })).toBe(true);
  });

  it("BOOLEAN accepts true/false/0/1 only", () => {
    expect(check("BOOLEAN", { default: "true" })).toBe(true);
    expect(check("BOOLEAN", { default: "FALSE" })).toBe(true);
    expect(check("BOOLEAN", { default: "1" })).toBe(true);
    expect(check("BOOLEAN", { default: "2" })).toBe(false);
  });

  it("TIMESTAMP accepts CURRENT_TIMESTAMP and in-range datetimes", () => {
    expect(check("TIMESTAMP", { default: "CURRENT_TIMESTAMP" })).toBe(true);
    expect(check("TIMESTAMP", { default: "2020-01-01 00:00:00" })).toBe(true);
    expect(check("TIMESTAMP", { default: "1930-01-01 00:00:00" })).toBe(false);
    expect(check("TIMESTAMP", { default: "not a date" })).toBe(false);
  });

  it("YEAR accepts a 4-digit year", () => {
    expect(check("YEAR", { default: "2024" })).toBe(true);
    expect(check("YEAR", { default: "24" })).toBe(false);
  });

  it("ENUM accepts only declared members", () => {
    expect(check("ENUM", { default: "a", values: ["a", "b"] })).toBe(true);
    expect(check("ENUM", { default: "z", values: ["a", "b"] })).toBe(false);
  });

  it("SET accepts a comma list of declared members", () => {
    expect(check("SET", { default: "a,b", values: ["a", "b", "c"] })).toBe(true);
    expect(check("SET", { default: "a,z", values: ["a", "b", "c"] })).toBe(false);
  });

  it("BIT accepts only 0 or 1", () => {
    expect(check("BIT", { default: "1" })).toBe(true);
    expect(check("BIT", { default: "0" })).toBe(true);
    expect(check("BIT", { default: "2" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (d) MySQL migration: MODIFY COLUMN must re-emit the full column definition.
// ---------------------------------------------------------------------------

describe("generateMigrationSQL (MySQL) — MODIFY preserves attributes", () => {
  const usersTable = (field) => ({
    id: 1,
    name: "users",
    comment: "",
    inherits: [],
    uniqueConstraints: [],
    indices: [],
    fields: [field],
  });

  it("keeps UNSIGNED, NOT NULL and DEFAULT on a comment change", () => {
    const base = {
      id: 10,
      name: "cnt",
      type: "INTEGER",
      size: "",
      notNull: true,
      primary: false,
      unique: false,
      increment: false,
      unsigned: true,
      default: "7",
      check: "",
      comment: "",
      values: [],
    };
    const from = { tables: [usersTable({ ...base })] };
    const to = { tables: [usersTable({ ...base, comment: "a count" })] };
    const { up } = generateMigrationSQL(
      {
        "tables[id=1,name=users]#fields[id=10,name=cnt,type=INTEGER]#comment": {
          from: "",
          to: "a count",
        },
      },
      DB.MYSQL,
      { from, to },
    );
    expect(up).toMatch(/MODIFY COLUMN/i);
    expect(up).toContain("UNSIGNED");
    expect(up).toContain("NOT NULL");
    expect(up).toContain("DEFAULT 7");
    expect(up).toContain("COMMENT 'a count'");
  });

  it("keeps AUTO_INCREMENT on a comment change", () => {
    const base = {
      id: 10,
      name: "id",
      type: "INTEGER",
      size: "",
      notNull: true,
      primary: false,
      unique: false,
      increment: true,
      unsigned: true,
      default: "",
      check: "",
      comment: "",
      values: [],
    };
    const from = { tables: [usersTable({ ...base })] };
    const to = { tables: [usersTable({ ...base, comment: "pk" })] };
    const { up } = generateMigrationSQL(
      {
        "tables[id=1,name=users]#fields[id=10,name=id,type=INTEGER]#comment": {
          from: "",
          to: "pk",
        },
      },
      DB.MYSQL,
      { from, to },
    );
    expect(up).toMatch(/MODIFY COLUMN/i);
    expect(up).toContain("AUTO_INCREMENT");
    expect(up).toContain("UNSIGNED");
    // MODIFY COLUMN must not carry index attributes (PRIMARY KEY/UNIQUE).
    expect(up).not.toContain("PRIMARY KEY");
  });
});

// ---------------------------------------------------------------------------
// (e) Live-engine validation against the current MySQL release (mysql84).
//     Gated on DRAWDB_LIVE_DB=1.
// ---------------------------------------------------------------------------

// Spinning up a throwaway mysql84 server (initialise data dir + start + load)
// takes far longer than vitest's 5s default, so each live case gets a generous
// timeout matching runLiveDDL's own 180s ceiling.
const LIVE_TIMEOUT = 180000;

(LIVE_DB ? describe : describe.skip)("live mysql", () => {
  const expectAccepted = (sql) => {
    const res = runLiveDDL("mysql", sql);
    if (!res.ok) throw new Error(`MySQL 8.4 rejected DDL:\n${res.error}\n\n--- SQL ---\n${sql}`);
    expect(res.ok).toBe(true);
  };

  it("accepts a feature-rich CREATE TABLE (ENUM/SET/UNSIGNED/CHECK/COMMENT/index)", () => {
    const sql = toMySQL(
      mkDiagram([
        mkTable({
          name: "users",
          comment: "user table",
          indices: [{ id: 0, name: "idx_role", unique: false, fields: ["role"] }],
          fields: [
            mkField({ name: "id", type: "INTEGER", notNull: true, primary: true, increment: true, unsigned: true }),
            mkField({ name: "role", type: "ENUM", notNull: true, default: "a", values: ["a", "b", "c"] }),
            mkField({ name: "tags", type: "SET", values: ["x", "y"] }),
            mkField({ name: "score", type: "INTEGER", default: "0", check: "score >= 0", comment: "the score" }),
            mkField({ name: "email", type: "VARCHAR", size: 255, unique: true }),
          ],
        }),
      ]),
    );
    expectAccepted(sql);
  }, LIVE_TIMEOUT);

  it("accepts two tables with a single-column FOREIGN KEY", () => {
    const users = mkTable({ name: "users", fields: [mkField({ name: "id", type: "INTEGER", notNull: true, primary: true })] });
    const posts = mkTable({
      name: "posts",
      fields: [
        mkField({ name: "id", type: "INTEGER", notNull: true, primary: true }),
        mkField({ name: "author_id", type: "INTEGER" }),
      ],
    });
    const ref = {
      id: 1,
      startTableId: posts.id,
      endTableId: users.id,
      startFieldId: posts.fields[1].id,
      endFieldId: users.fields[0].id,
      fields: [{ startFieldId: posts.fields[1].id, endFieldId: users.fields[0].id }],
      updateConstraint: "No action",
      deleteConstraint: "Cascade",
    };
    expectAccepted(toMySQL(mkDiagram([users, posts], [ref])));
  }, LIVE_TIMEOUT);

  it("accepts a composite PRIMARY KEY and composite FOREIGN KEY", () => {
    const parent = mkTable({
      name: "parent",
      fields: [
        mkField({ name: "a", type: "INTEGER", notNull: true, primary: true }),
        mkField({ name: "b", type: "INTEGER", notNull: true, primary: true }),
      ],
    });
    const child = mkTable({
      name: "child",
      fields: [
        mkField({ name: "x", type: "INTEGER" }),
        mkField({ name: "y", type: "INTEGER" }),
      ],
    });
    const ref = {
      id: 1,
      startTableId: child.id,
      endTableId: parent.id,
      startFieldId: child.fields[0].id,
      endFieldId: parent.fields[0].id,
      fields: [
        { startFieldId: child.fields[0].id, endFieldId: parent.fields[0].id },
        { startFieldId: child.fields[1].id, endFieldId: parent.fields[1].id },
      ],
      updateConstraint: "Cascade",
      deleteConstraint: "No action",
    };
    expectAccepted(toMySQL(mkDiagram([parent, child], [ref])));
  }, LIVE_TIMEOUT);
});
