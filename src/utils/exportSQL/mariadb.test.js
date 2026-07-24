import { describe, it, expect } from "vitest";
import { exportSQL } from "./index";
import { roundTrip, LIVE_DB, runLiveDDL } from "../sqlTestKit";
import { generateMigrationSQL } from "../migrations/diffToSQL";
import { dbToTypes } from "../../data/datatypes";
import { DB } from "../../data/constants";

// ---- fixture helpers -----------------------------------------------------

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

// A feature-rich but engine-valid MariaDB diagram: composite PK, FK (single +
// composite), AUTO_INCREMENT, CHECK, ENUM/SET, UNIQUE, index, comments.
function richDiagram() {
  return {
    database: DB.MARIADB,
    tables: [
      {
        id: 1,
        name: "users",
        comment: "people",
        indices: [{ id: 0, name: "idx_email", unique: false, fields: ["email"] }],
        uniqueConstraints: [],
        fields: [
          field({ id: 10, name: "id", type: "INTEGER", notNull: true, primary: true, increment: true }),
          field({ id: 11, name: "email", type: "VARCHAR", size: "255", notNull: true, unique: true }),
          field({ id: 12, name: "state", type: "ENUM", values: ["active", "inactive"], default: "active", comment: "the state" }),
          field({ id: 13, name: "roles", type: "SET", values: ["admin", "user"] }),
          field({ id: 14, name: "age", type: "INTEGER", check: "age > 0" }),
        ],
      },
      {
        id: 2,
        name: "posts",
        comment: "",
        indices: [],
        uniqueConstraints: [{ id: 0, name: "uq_slug", fields: ["slug"] }],
        fields: [
          field({ id: 20, name: "a", type: "INTEGER", notNull: true, primary: true }),
          field({ id: 21, name: "b", type: "INTEGER", notNull: true, primary: true }),
          field({ id: 22, name: "author_id", type: "INTEGER" }),
          field({ id: 23, name: "slug", type: "VARCHAR", size: "100" }),
        ],
      },
      {
        id: 3,
        name: "comp",
        comment: "",
        indices: [],
        uniqueConstraints: [],
        fields: [
          field({ id: 30, name: "x", type: "INTEGER" }),
          field({ id: 31, name: "y", type: "INTEGER" }),
        ],
      },
    ],
    references: [
      { id: 100, name: "fk_posts_author", startTableId: 2, startFieldId: 22, endTableId: 1, endFieldId: 10, updateConstraint: "No action", deleteConstraint: "Cascade" },
      { id: 101, name: "fk_comp_posts", startTableId: 3, startFieldId: 30, endTableId: 2, endFieldId: 20, updateConstraint: "No action", deleteConstraint: "No action", fields: [{ startFieldId: 30, endFieldId: 20 }, { startFieldId: 31, endFieldId: 21 }] },
    ],
    enums: [],
    types: [],
  };
}

// A single table (no FK) so the ONLY parser gap in play is CREATE OR REPLACE.
function singleTable() {
  return {
    database: DB.MARIADB,
    references: [],
    enums: [],
    types: [],
    tables: [
      {
        id: 1,
        name: "users",
        comment: "people",
        indices: [{ id: 0, name: "idx_email", unique: false, fields: ["email"] }],
        uniqueConstraints: [{ id: 0, name: "uq_email", fields: ["email"] }],
        fields: [
          field({ id: 10, name: "id", type: "INTEGER", notNull: true, primary: true, increment: true }),
          field({ id: 11, name: "email", type: "VARCHAR", size: "255", notNull: true, unique: true }),
          field({ id: 12, name: "state", type: "ENUM", values: ["active", "inactive"], default: "active", comment: "the state" }),
        ],
      },
    ],
  };
}

// ---- (a) export feature-assertions ---------------------------------------

describe("toMariaDB export feature-assertions", () => {
  const sql = exportSQL(richDiagram());

  it("uses CREATE OR REPLACE TABLE (the MariaDB-specific form)", () => {
    expect(sql).toContain("CREATE OR REPLACE TABLE `users`");
    expect(sql).not.toContain("CREATE TABLE IF NOT EXISTS");
  });

  it("quotes identifiers with backticks", () => {
    expect(sql).toContain("`email`");
  });

  it("emits NOT NULL, AUTO_INCREMENT and inline UNIQUE", () => {
    expect(sql).toContain("`id` INTEGER NOT NULL AUTO_INCREMENT");
    expect(sql).toContain("`email` VARCHAR(255) NOT NULL UNIQUE");
  });

  it("emits ENUM/SET with values, a DEFAULT and a column COMMENT", () => {
    expect(sql).toContain("`state` ENUM('active', 'inactive') DEFAULT 'active' COMMENT 'the state'");
    expect(sql).toContain("`roles` SET('admin', 'user')");
  });

  it("emits an inline CHECK for a checkable type", () => {
    expect(sql).toContain("`age` INTEGER CHECK(age > 0)");
  });

  it("emits a composite PRIMARY KEY", () => {
    expect(sql).toContain("PRIMARY KEY(`a`, `b`)");
  });

  it("emits a table COMMENT and a named UNIQUE constraint", () => {
    expect(sql).toContain("COMMENT='people'");
    expect(sql).toContain("CONSTRAINT `uq_slug` UNIQUE (`slug`)");
  });

  it("emits CREATE INDEX and trailing FK ALTER statements", () => {
    expect(sql).toContain("CREATE INDEX `idx_email`\nON `users` (`email`)");
    expect(sql).toContain("ALTER TABLE `posts`\nADD FOREIGN KEY(`author_id`) REFERENCES `users`(`id`)");
    expect(sql).toContain("ON UPDATE NO ACTION ON DELETE CASCADE");
    // composite FK keeps both column pairs in order
    expect(sql).toContain("ADD FOREIGN KEY(`x`, `y`) REFERENCES `posts`(`a`, `b`)");
  });
});

// ---- (b) round-trip ------------------------------------------------------

describe("toMariaDB round-trip", () => {
  // MariaDB is now parsed with the mysql grammar (see normalize.parserDatabase)
  // and normalize strips `OR REPLACE`, so the real exporter output --
  // `CREATE OR REPLACE TABLE` + `ADD CONSTRAINT ... FOREIGN KEY` -- flows
  // straight through the kit's roundTrip().
  it("re-imports a table faithfully", () => {
    const { imported } = roundTrip(singleTable());
    const t = imported.tables[0];
    expect(t.name).toBe("users");
    expect(t.comment).toBe("people");
    const byN = (n) => t.fields.find((f) => f.name === n);
    expect(byN("id").primary).toBe(true);
    expect(byN("id").increment).toBe(true);
    expect(byN("email").unique).toBe(true);
    expect(byN("email").notNull).toBe(true);
    expect(byN("state").type).toBe("ENUM");
    expect(byN("state").values).toEqual(["active", "inactive"]);
    expect(byN("state").default).toBe("active");
    expect(byN("state").comment).toBe("the state");
    expect(t.uniqueConstraints).toEqual([
      { name: "uq_email", fields: ["email"], id: 0 },
    ]);
    expect(t.indices.map((i) => i.name)).toEqual(["idx_email"]);
  });

  it("re-imports foreign keys (ADD CONSTRAINT ... FOREIGN KEY now parses)", () => {
    const { imported } = roundTrip(richDiagram());
    expect(imported.relationships.length).toBeGreaterThanOrEqual(1);
  });
});

// ---- (c) dbToTypes[DB.MARIADB] checkDefault ------------------------------

describe("dbToTypes[DB.MARIADB] checkDefault", () => {
  const types = dbToTypes[DB.MARIADB];
  const ck = (type, o) => types[type].checkDefault(field({ id: 1, name: "c", type, ...o }));

  it("accepts/rejects INTEGER defaults", () => {
    expect(ck("INTEGER", { default: "42" })).toBe(true);
    expect(ck("INTEGER", { default: "-7" })).toBe(true);
    expect(ck("INTEGER", { default: "4.2" })).toBe(false);
  });

  it("accepts/rejects DECIMAL defaults", () => {
    expect(ck("DECIMAL", { default: "3.14" })).toBe(true);
    expect(ck("DECIMAL", { default: "nope" })).toBe(false);
  });

  it("accepts/rejects BOOLEAN defaults", () => {
    expect(ck("BOOLEAN", { default: "true" })).toBe(true);
    expect(ck("BOOLEAN", { default: "FALSE" })).toBe(true);
    expect(ck("BOOLEAN", { default: "1" })).toBe(true);
    expect(ck("BOOLEAN", { default: "2" })).toBe(false);
  });

  it("bounds a VARCHAR default by its size", () => {
    expect(ck("VARCHAR", { default: "abcd", size: 10 })).toBe(true);
    expect(ck("VARCHAR", { default: "abcdef", size: 3 })).toBe(false);
  });

  it("validates ENUM/SET defaults against their values", () => {
    expect(ck("ENUM", { default: "a", values: ["a", "b"] })).toBe(true);
    expect(ck("ENUM", { default: "z", values: ["a", "b"] })).toBe(false);
    expect(ck("SET", { default: "a,b", values: ["a", "b"] })).toBe(true);
    expect(ck("SET", { default: "a,z", values: ["a", "b"] })).toBe(false);
  });

  it("exposes MariaDB-only network types absent from MySQL (permissive default)", () => {
    for (const t of ["INET4", "INET6", "UUID"]) {
      expect(types[t]).toBeTruthy();
      expect(types[t].checkDefault(field({ id: 1, name: "c", type: t, default: "whatever" }))).toBe(true);
    }
    // INET4/INET6 do not exist for MySQL -- the proxy returns false there.
    expect(dbToTypes[DB.MYSQL].INET6).toBe(false);
    expect(dbToTypes[DB.MYSQL].INET4).toBe(false);
  });
});

// ---- (d) MariaDB generateMigrationSQL ALTER assertions -------------------

describe("generateMigrationSQL (MariaDB) ALTER output", () => {
  const tbl = (name, fields, extra = {}) => ({
    id: 1,
    name,
    comment: "",
    indices: [],
    uniqueConstraints: [],
    fields,
    ...extra,
  });
  const mig = (diff, diagrams) => generateMigrationSQL(diff, DB.MARIADB, diagrams);

  it("adds a table with CREATE OR REPLACE TABLE and drops it on down", () => {
    const t = tbl(
      "widget",
      [field({ id: 10, name: "id", type: "INTEGER", notNull: true, primary: true }), field({ id: 11, name: "label", type: "VARCHAR", size: "50" })],
      { comment: "a widget" },
    );
    const { up, down } = mig(
      { "tables[id=1,name=widget]": { to: t, from: null } },
      { from: { tables: [] }, to: { tables: [t] } },
    );
    expect(up).toContain("CREATE OR REPLACE TABLE `widget`");
    expect(up).toContain("COMMENT='a widget'");
    expect(down).toBe("DROP TABLE `widget`;");
  });

  it("adds a column with ADD COLUMN", () => {
    const before = tbl("t", [field({ id: 10, name: "id", type: "INTEGER", primary: true })]);
    const added = field({ id: 11, name: "note", type: "VARCHAR", size: "20", default: "hi" });
    const after = tbl("t", [before.fields[0], added]);
    const { up, down } = mig(
      { "tables[id=1,name=t]#fields[id=11,name=note,type=VARCHAR]": { to: added, from: null } },
      { from: { tables: [before] }, to: { tables: [after] } },
    );
    expect(up).toBe("ALTER TABLE `t` ADD COLUMN `note` VARCHAR(20) DEFAULT 'hi';");
    expect(down).toBe("ALTER TABLE `t` DROP COLUMN `note`;");
  });

  it("changes a type with a full MODIFY COLUMN (keeps NOT NULL + DEFAULT)", () => {
    const before = tbl("t", [field({ id: 10, name: "c", type: "INTEGER", notNull: true, default: "1" })]);
    const after = tbl("t", [field({ id: 10, name: "c", type: "BIGINT", notNull: true, default: "1" })]);
    const { up, down } = mig(
      { "tables[id=1,name=t]#fields[id=10,name=c,type=BIGINT]#type": { from: "INT", to: "BIGINT" } },
      { from: { tables: [before] }, to: { tables: [after] } },
    );
    // Regression guard: MODIFY must re-emit the whole definition, not drop
    // NOT NULL / DEFAULT.
    expect(up).toBe("ALTER TABLE `t` MODIFY COLUMN `c` BIGINT NOT NULL DEFAULT 1;");
    expect(down).toBe("ALTER TABLE `t` MODIFY COLUMN `c` INTEGER NOT NULL DEFAULT 1;");
  });

  it("changes a table comment with COMMENT= and renames with RENAME TABLE", () => {
    const c = mig(
      { "tables[id=1,name=t]#comment": { from: "old", to: "new" } },
      { from: { tables: [] }, to: { tables: [] } },
    );
    expect(c.up).toBe("ALTER TABLE `t` COMMENT='new';");
    expect(c.down).toBe("ALTER TABLE `t` COMMENT='old';");

    const r = mig(
      { "tables[id=1,name=t]#name": { from: "t", to: "t2" } },
      { from: { tables: [] }, to: { tables: [] } },
    );
    expect(r.up).toBe("RENAME TABLE `t` TO `t2`;");
    expect(r.down).toBe("RENAME TABLE `t2` TO `t`;");
  });

  it("adds a FK with ADD CONSTRAINT ... FOREIGN KEY and drops it with DROP FOREIGN KEY", () => {
    const u = { ...tbl("users", [field({ id: 10, name: "id", type: "INTEGER", primary: true })]), id: "U" };
    const p = { ...tbl("posts", [field({ id: 20, name: "author_id", type: "INTEGER" })]), id: "P" };
    const rel = {
      id: "R1",
      name: "fk_posts_users",
      startTableId: "P",
      startFieldId: 20,
      endTableId: "U",
      endFieldId: 10,
      updateConstraint: "No action",
      deleteConstraint: "Cascade",
      fields: [{ startFieldId: 20, endFieldId: 10 }],
    };
    const { up, down } = mig(
      { "relationships[id=R1,name=fk_posts_users]": { to: rel, from: null } },
      {
        from: { tables: [u, p], relationships: [], references: [] },
        to: { tables: [u, p], relationships: [rel], references: [rel] },
      },
    );
    expect(up).toBe(
      "ALTER TABLE `posts` ADD CONSTRAINT `fk_posts_users` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON UPDATE NO ACTION ON DELETE CASCADE;",
    );
    expect(down).toBe("ALTER TABLE `posts` DROP FOREIGN KEY `fk_posts_users`;");
  });
});

// ---- (e) live MariaDB: the current release must accept our DDL -----------

// Spinning up a throwaway MariaDB (init + start + load) easily exceeds vitest's
// 5s default; runLiveDDL itself caps at 180s, so match that here.
const LIVE_TIMEOUT = 180000;

(LIVE_DB ? describe : describe.skip)("live mariadb", () => {
  it(
    "accepts the full-featured CREATE/INDEX/FK export",
    () => {
      const sql = exportSQL(richDiagram());
      const res = runLiveDDL("mariadb", sql);
      expect(res.ok, res.error).toBe(true);
    },
    LIVE_TIMEOUT,
  );

  it(
    "accepts the migration up SQL (CREATE OR REPLACE + ALTER)",
    () => {
      const t = {
        id: 1,
        name: "widget",
        comment: "a widget",
        indices: [],
        uniqueConstraints: [],
        fields: [
          field({ id: 10, name: "id", type: "INTEGER", notNull: true, primary: true, increment: true }),
          field({ id: 11, name: "label", type: "VARCHAR", size: "50", default: "x" }),
        ],
      };
      const { up } = generateMigrationSQL(
        { "tables[id=1,name=widget]": { to: t, from: null } },
        DB.MARIADB,
        { from: { tables: [] }, to: { tables: [t] } },
      );
      const res = runLiveDDL("mariadb", up);
      expect(res.ok, res.error).toBe(true);
    },
    LIVE_TIMEOUT,
  );
});
