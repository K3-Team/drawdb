import { describe, it, expect } from "vitest";
import { toSqlite } from "./sqlite";
import { generateMigrationSQL } from "../migrations/diffToSQL";
import { roundTrip, LIVE_DB, runLiveDDL } from "../sqlTestKit";
import { DB } from "../../data/constants";
import { dbToTypes } from "../../data/datatypes";

// ---- Fixture builders -----------------------------------------------------
let idc = 1;
const nextId = () => idc++;

const makeField = (o = {}) => ({
  id: nextId(),
  name: "col",
  type: "INTEGER",
  size: "",
  notNull: false,
  primary: false,
  unique: false,
  increment: false,
  default: "",
  check: "",
  comment: "",
  values: [],
  ...o,
});

const makeTable = (o = {}) => ({
  id: nextId(),
  name: "t",
  comment: "",
  indices: [],
  uniqueConstraints: [],
  fields: [],
  ...o,
});

const makeDiagram = (tables, references = []) => ({
  database: DB.SQLITE,
  tables,
  references,
  enums: [],
  types: [],
});

// ---- (a) Export feature assertions ---------------------------------------
describe("toSqlite: column feature emission", () => {
  const sql = toSqlite(
    makeDiagram([
      makeTable({
        name: "users",
        comment: "the users table",
        fields: [
          makeField({ name: "id", type: "INTEGER", primary: true }),
          makeField({ name: "email", type: "TEXT", notNull: true, unique: true }),
          makeField({ name: "age", type: "INTEGER", default: "18", check: "age > 0" }),
          makeField({ name: "bio", type: "VARCHAR", size: 255, default: "hi" }),
        ],
        uniqueConstraints: [{ id: 0, name: "uq_email_age", fields: ["email", "age"] }],
        indices: [{ id: 0, name: "idx_email", unique: false, fields: ["email"] }],
      }),
    ]),
  );

  it("wraps identifiers in ANSI double quotes", () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "users"');
    expect(sql).toContain('"email"');
  });

  it("emits NOT NULL and UNIQUE inline", () => {
    expect(sql).toContain('"email" TEXT NOT NULL UNIQUE');
  });

  it("emits an unquoted numeric DEFAULT and a quoted string DEFAULT", () => {
    expect(sql).toContain("DEFAULT 18");
    expect(sql).toContain("DEFAULT 'hi'");
  });

  it("emits a CHECK clause for a type that hasCheck", () => {
    expect(sql).toContain("CHECK(age > 0)");
  });

  it("emits a table-level PRIMARY KEY clause", () => {
    expect(sql).toContain('PRIMARY KEY("id")');
  });

  it("emits a named composite UNIQUE constraint", () => {
    expect(sql).toContain('CONSTRAINT "uq_email_age" UNIQUE ("email", "age")');
  });

  it("emits CREATE INDEX IF NOT EXISTS for a table index", () => {
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "idx_email"');
    expect(sql).toContain('ON "users" ("email")');
  });

  it("renders the table comment as a block comment", () => {
    expect(sql).toContain("/* the users table */");
  });
});

describe("toSqlite: composite primary key and inline foreign keys", () => {
  it("lists every primary column in one PRIMARY KEY clause", () => {
    const sql = toSqlite(
      makeDiagram([
        makeTable({
          name: "membership",
          fields: [
            makeField({ name: "org", type: "INTEGER", primary: true }),
            makeField({ name: "usr", type: "INTEGER", primary: true }),
          ],
        }),
      ]),
    );
    expect(sql).toContain('PRIMARY KEY("org", "usr")');
  });

  it("emits an inline FOREIGN KEY with referential actions", () => {
    const users = makeTable({
      name: "users",
      fields: [makeField({ name: "id", type: "INTEGER", primary: true })],
    });
    const posts = makeTable({
      name: "posts",
      fields: [
        makeField({ name: "id", type: "INTEGER", primary: true }),
        makeField({ name: "author", type: "INTEGER" }),
      ],
    });
    const ref = {
      id: nextId(),
      name: "fk_posts_author",
      startTableId: posts.id,
      endTableId: users.id,
      startFieldId: posts.fields[1].id,
      endFieldId: users.fields[0].id,
      updateConstraint: "No action",
      deleteConstraint: "Cascade",
      cardinality: "many_to_one",
    };
    const sql = toSqlite(makeDiagram([users, posts], [ref]));
    expect(sql).toContain('FOREIGN KEY ("author") REFERENCES "users"("id")');
    expect(sql).toContain("ON DELETE CASCADE");
  });
});

// ---- (b) Round trip -------------------------------------------------------
describe("toSqlite: round trip (diagram -> SQL -> diagram)", () => {
  it("preserves fields, constraints, an index and a relationship", () => {
    const users = makeTable({
      name: "users",
      fields: [
        makeField({ name: "id", type: "INTEGER", primary: true }),
        makeField({ name: "email", type: "TEXT", notNull: true, unique: true }),
        makeField({ name: "age", type: "INTEGER", default: "0", check: "age > 0" }),
      ],
      indices: [{ id: 0, name: "idx_users_email", unique: false, fields: ["email"] }],
    });
    const posts = makeTable({
      name: "posts",
      fields: [
        makeField({ name: "id", type: "INTEGER", primary: true }),
        makeField({ name: "author", type: "INTEGER" }),
      ],
    });
    const ref = {
      id: nextId(),
      name: "fk_posts_author",
      startTableId: posts.id,
      endTableId: users.id,
      startFieldId: posts.fields[1].id,
      endFieldId: users.fields[0].id,
      updateConstraint: "No action",
      deleteConstraint: "No action",
      cardinality: "many_to_one",
    };

    const { imported } = roundTrip(makeDiagram([users, posts], [ref]));

    const u = imported.tables.find((t) => t.name === "users");
    const p = imported.tables.find((t) => t.name === "posts");
    expect(u).toBeTruthy();
    expect(p).toBeTruthy();

    const id = u.fields.find((f) => f.name === "id");
    const email = u.fields.find((f) => f.name === "email");
    expect(id.primary).toBe(true);
    expect(email.notNull).toBe(true);
    expect(email.unique).toBe(true);

    expect(u.indices).toHaveLength(1);
    expect(u.indices[0].name).toBe("idx_users_email");
    expect(u.indices[0].fields).toEqual(["email"]);

    expect(imported.relationships).toHaveLength(1);
    expect(imported.relationships[0].startTableId).toBe(p.id);
    expect(imported.relationships[0].endTableId).toBe(u.id);
  });
});

// ---- (c) dbToTypes[DB.SQLITE] checkDefault --------------------------------
describe("dbToTypes[DB.SQLITE] checkDefault", () => {
  const cd = (type, def, size = "") =>
    dbToTypes[DB.SQLITE][type].checkDefault({ default: def, size });

  it("INTEGER accepts integers, rejects non-integers", () => {
    expect(cd("INTEGER", "42")).toBe(true);
    expect(cd("INTEGER", "-7")).toBe(true);
    expect(cd("INTEGER", "3.5")).toBe(false);
    expect(cd("INTEGER", "abc")).toBe(false);
  });

  it("REAL accepts decimals", () => {
    expect(cd("REAL", "3.14")).toBe(true);
    expect(cd("REAL", "10")).toBe(true);
    expect(cd("REAL", "abc")).toBe(false);
  });

  it("BOOLEAN accepts true/false/0/1", () => {
    for (const v of ["true", "false", "TRUE", "0", "1"]) expect(cd("BOOLEAN", v)).toBe(true);
    expect(cd("BOOLEAN", "2")).toBe(false);
  });

  it("VARCHAR enforces the declared size", () => {
    expect(cd("VARCHAR", "hello", 10)).toBe(true);
    expect(cd("VARCHAR", "hello", 3)).toBe(false);
    // quoted literal: the two quote chars are excluded from the length budget.
    expect(cd("VARCHAR", "'hello'", 5)).toBe(true);
  });

  it("TEXT accepts any default", () => {
    expect(cd("TEXT", "anything at all")).toBe(true);
  });

  it("TIMESTAMP accepts CURRENT_TIMESTAMP and an in-range datetime", () => {
    expect(cd("TIMESTAMP", "CURRENT_TIMESTAMP")).toBe(true);
    expect(cd("TIMESTAMP", "2020-01-01 12:00:00")).toBe(true);
    expect(cd("TIMESTAMP", "not a date")).toBe(false);
  });

  it("DATE accepts YYYY-MM-DD only", () => {
    expect(cd("DATE", "2020-01-01")).toBe(true);
    expect(cd("DATE", "2020/01/01")).toBe(false);
  });

  it("TIME accepts HH:MM:SS", () => {
    expect(cd("TIME", "12:30:00")).toBe(true);
    expect(cd("TIME", "25:00:00")).toBe(false);
  });

  it("returns false (via the Proxy) for an unknown type", () => {
    // sqliteTypes is a Proxy returning false for absent keys.
    expect(dbToTypes[DB.SQLITE].NOPE).toBe(false);
  });
});

// ---- (d) generateMigrationSQL — SQLite no-op / guard cases ----------------
// SQLite's ALTER TABLE is intentionally minimal, so diffToSQL guards many paths.
const migField = (o = {}) => ({
  id: 10,
  name: "a",
  type: "INTEGER",
  size: "",
  notNull: false,
  primary: false,
  unique: false,
  increment: false,
  default: "",
  check: "",
  comment: "",
  values: [],
  ...o,
});
const migTable = (o = {}) => ({
  id: 1,
  name: "t",
  comment: "",
  inherits: [],
  uniqueConstraints: [],
  indices: [],
  fields: [migField()],
  ...o,
});
const gen = (diff, from = { tables: [] }, to = { tables: [] }) =>
  generateMigrationSQL(diff, DB.SQLITE, { from, to });

describe("generateMigrationSQL (SQLite): supported statements", () => {
  it("adding a table emits CREATE up / DROP down", () => {
    const to = { tables: [migTable({ name: "users" })] };
    const { up, down } = gen(
      { "tables[id=1,name=users]": { to: to.tables[0], from: null } },
      { tables: [] },
      to,
    );
    expect(up).toMatch(/CREATE TABLE IF NOT EXISTS "users"/);
    expect(down).toMatch(/DROP TABLE "users"/);
  });

  it("renaming a column emits ALTER TABLE ... RENAME COLUMN (valid in SQLite)", () => {
    const { up, down } = gen({
      "tables[id=1,name=t]#fields[id=10,name=a,type=INTEGER]#name": { from: "a", to: "b" },
    });
    expect(up).toBe('ALTER TABLE "t" RENAME COLUMN "a" TO "b";');
    expect(down).toBe('ALTER TABLE "t" RENAME COLUMN "b" TO "a";');
  });

  it("renaming a table emits ALTER TABLE ... RENAME TO", () => {
    const { up } = gen({ "tables[id=1,name=t]#name": { from: "t", to: "t2" } });
    expect(up).toBe('ALTER TABLE "t" RENAME TO "t2";');
  });

  it("adding an index emits CREATE INDEX IF NOT EXISTS", () => {
    const idx = { id: 0, name: "ix", unique: false, fields: ["a"] };
    const { up, down } = gen({
      "tables[id=1,name=t]#indices[id=0,name=ix]": { from: null, to: idx },
    });
    expect(up).toBe('CREATE INDEX IF NOT EXISTS "ix" ON "t" ("a");');
    expect(down).toBe('DROP INDEX "ix";');
  });
});

describe("generateMigrationSQL (SQLite): guarded no-ops", () => {
  const empty = { up: "", down: "" };

  it("relationship add/drop produces no migration SQL", () => {
    expect(
      gen({ "relationships[id=1]": { to: { name: "fk" }, from: null } }),
    ).toEqual(empty);
  });

  it("column type change is a no-op (SQLite cannot ALTER COLUMN TYPE)", () => {
    expect(
      gen({
        "tables[id=1,name=t]#fields[id=10,name=a,type=TEXT]#type": {
          from: "INTEGER",
          to: "TEXT",
        },
      }),
    ).toEqual(empty);
  });

  it("column notNull change is a no-op", () => {
    expect(
      gen({
        "tables[id=1,name=t]#fields[id=10,name=a,type=INTEGER]#notNull": {
          from: false,
          to: true,
        },
      }),
    ).toEqual(empty);
  });

  it("column size change is a no-op", () => {
    expect(
      gen({
        "tables[id=1,name=t]#fields[id=10,name=a,type=VARCHAR]#size": {
          from: 10,
          to: 20,
        },
      }),
    ).toEqual(empty);
  });

  it("column comment change emits a line comment, not DDL", () => {
    const { up, down } = gen({
      "tables[id=1,name=t]#fields[id=10,name=a,type=INTEGER]#comment": {
        from: "",
        to: "hi",
      },
    });
    expect(up.trim()).toMatch(/^--/);
    expect(up).not.toMatch(/ALTER/i);
    expect(down.trim()).toMatch(/^--/);
  });

  it("table comment change emits a line comment, not DDL", () => {
    const { up } = gen({ "tables[id=1,name=t]#comment": { from: "", to: "desc" } });
    expect(up).toMatch(/^-- TABLE COMMENT:/);
    expect(up).not.toMatch(/ALTER/i);
  });

  // KNOWN SHARED BUG (diffToSQL.js): SQLite is not guarded for `default`,
  // `unique`, `primary` or `check` column-property changes, so it emits generic
  // diffToSQL.js now guards SQLite for default/unique/primary/check changes
  // (SQLite has no ALTER COLUMN and no ADD CONSTRAINT), so these emit nothing.
  it("default change is a no-op for SQLite", () => {
    const { up } = gen({
      "tables[id=1,name=t]#fields[id=10,name=a,type=INTEGER]#default": {
        from: "",
        to: "5",
      },
    });
    expect(up).toEqual("");
  });

  it("unique change is a no-op for SQLite", () => {
    const { up } = gen({
      "tables[id=1,name=t]#fields[id=10,name=a,type=INTEGER]#unique": {
        from: false,
        to: true,
      },
    });
    expect(up).toEqual("");
  });
});

// ---- (e) Live engine: current SQLite must accept our generated DDL --------
(LIVE_DB ? describe : describe.skip)("live sqlite", () => {
  it("accepts the exported DDL for a comprehensive diagram", () => {
    const users = makeTable({
      name: "users",
      comment: "application users",
      fields: [
        makeField({ name: "id", type: "INTEGER", primary: true, increment: true }),
        makeField({ name: "email", type: "TEXT", notNull: true, unique: true, comment: "login email" }),
        makeField({ name: "age", type: "INTEGER", default: "18", check: "age >= 0" }),
        makeField({ name: "bio", type: "VARCHAR", size: 255, default: "n/a" }),
        makeField({ name: "created", type: "TIMESTAMP", default: "CURRENT_TIMESTAMP" }),
      ],
      uniqueConstraints: [{ id: 0, name: "uq_email_age", fields: ["email", "age"] }],
      indices: [{ id: 0, name: "idx_users_email", unique: true, fields: ["email"] }],
    });
    const membership = makeTable({
      name: "membership",
      fields: [
        makeField({ name: "org", type: "INTEGER", primary: true }),
        makeField({ name: "usr", type: "INTEGER", primary: true }),
      ],
    });
    const posts = makeTable({
      name: "posts",
      fields: [
        makeField({ name: "id", type: "INTEGER", primary: true }),
        makeField({ name: "author", type: "INTEGER" }),
      ],
    });
    const ref = {
      id: nextId(),
      name: "fk_posts_author",
      startTableId: posts.id,
      endTableId: users.id,
      startFieldId: posts.fields[1].id,
      endFieldId: users.fields[0].id,
      updateConstraint: "No action",
      deleteConstraint: "Cascade",
      cardinality: "many_to_one",
    };

    const sql = toSqlite(makeDiagram([users, membership, posts], [ref]));
    const res = runLiveDDL("sqlite", sql);
    expect(res.ok, res.error).toBe(true);
  });
});
