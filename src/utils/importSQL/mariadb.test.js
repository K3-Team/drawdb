import { describe, it, expect } from "vitest";
import { Parser } from "node-sql-parser";
import { parseAndImport } from "../sqlTestKit";
import { normalizeSQLForParser } from "./normalize";
import { DB } from "../../data/constants";

// MariaDB CREATE import feature-matrix. SQL is parsed exactly like the app
// (normalizeSQLForParser -> node-sql-parser mariadb grammar -> fromMariaDB).
//
// The DDL here is plain `CREATE TABLE` (the shape of a real MariaDB dump). The
// bundled parser's mariadb grammar does NOT accept `CREATE OR REPLACE TABLE`
// (what toMariaDB emits) nor `ALTER TABLE ... ADD FOREIGN KEY`, so FKs are
// exercised via the inline form inside CREATE TABLE, which both the parser and
// fromMariaDB support. See the design doc (gaps G1/G2) and mariadb.test.js on
// the export side.

const imp = (sql) => parseAndImport(sql, DB.MARIADB);
const byName = (tables, name) => tables.find((t) => t.name === name);
const field = (t, name) => t.fields.find((f) => f.name === name);

describe("fromMariaDB import feature-matrix", () => {
  it("imports NOT NULL, a plain column, and a table+column COMMENT", () => {
    const d = imp(
      `CREATE TABLE users (
         id INTEGER NOT NULL,
         nickname VARCHAR(50) COMMENT 'display name'
       ) COMMENT='people';`,
    );
    const users = byName(d.tables, "users");
    expect(users).toBeTruthy();
    expect(users.comment).toBe("people");
    expect(field(users, "id").notNull).toBe(true);
    expect(field(users, "nickname").notNull).toBe(false);
    expect(field(users, "nickname").comment).toBe("display name");
  });

  it("imports a DEFAULT value", () => {
    const d = imp(
      `CREATE TABLE t (
         qty INTEGER DEFAULT 5,
         label VARCHAR(20) DEFAULT 'none'
       );`,
    );
    const t = byName(d.tables, "t");
    expect(field(t, "qty").default).toBe("5");
    expect(field(t, "label").default).toBe("none");
  });

  it("imports an inline CHECK expression", () => {
    const d = imp(`CREATE TABLE t (age INTEGER CHECK(age > 0));`);
    // buildSQLFromAST reconstructs the expression with backtick-quoted columns.
    expect(field(byName(d.tables, "t"), "age").check).toBe("`age` > 0");
  });

  it("imports a column UNIQUE flag", () => {
    const d = imp(`CREATE TABLE t (email VARCHAR(255) NOT NULL UNIQUE);`);
    expect(field(byName(d.tables, "t"), "email").unique).toBe(true);
  });

  it("imports AUTO_INCREMENT", () => {
    const d = imp(
      `CREATE TABLE t (id INTEGER NOT NULL AUTO_INCREMENT, PRIMARY KEY(id));`,
    );
    const id = field(byName(d.tables, "t"), "id");
    expect(id.increment).toBe(true);
    expect(id.primary).toBe(true);
  });

  it("imports a composite PRIMARY KEY declared at table level", () => {
    const d = imp(
      `CREATE TABLE t (a INTEGER, b INTEGER, c INTEGER, PRIMARY KEY(a, b));`,
    );
    const t = byName(d.tables, "t");
    expect(field(t, "a").primary).toBe(true);
    expect(field(t, "b").primary).toBe(true);
    expect(field(t, "c").primary).toBe(false);
  });

  it("imports a named UNIQUE constraint and a CREATE INDEX", () => {
    const d = imp(
      `CREATE TABLE t (
         slug VARCHAR(100),
         email VARCHAR(255),
         CONSTRAINT uq_slug UNIQUE (slug)
       );
       CREATE INDEX idx_email ON t (email);
       CREATE UNIQUE INDEX idx_slug ON t (slug);`,
    );
    const t = byName(d.tables, "t");
    expect(t.uniqueConstraints).toEqual([
      { name: "uq_slug", fields: ["slug"], id: 0 },
    ]);
    expect(t.indices.map((i) => ({ name: i.name, unique: i.unique }))).toEqual([
      { name: "idx_email", unique: false },
      { name: "idx_slug", unique: true },
    ]);
  });

  it("imports ENUM and SET types with their values (and an ENUM default)", () => {
    const d = imp(
      `CREATE TABLE t (
         state ENUM('active', 'inactive') DEFAULT 'active',
         roles SET('admin', 'user')
       );`,
    );
    const t = byName(d.tables, "t");
    expect(field(t, "state").type).toBe("ENUM");
    expect(field(t, "state").values).toEqual(["active", "inactive"]);
    expect(field(t, "state").default).toBe("active");
    expect(field(t, "roles").type).toBe("SET");
    expect(field(t, "roles").values).toEqual(["admin", "user"]);
  });

  it("imports a single-column inline FOREIGN KEY as a relationship", () => {
    const d = imp(
      `CREATE TABLE users (id INTEGER NOT NULL, PRIMARY KEY(id));
       CREATE TABLE posts (
         id INTEGER NOT NULL,
         author_id INTEGER,
         PRIMARY KEY(id),
         FOREIGN KEY (author_id) REFERENCES users(id)
           ON UPDATE NO ACTION ON DELETE CASCADE
       );`,
    );
    expect(d.relationships).toHaveLength(1);
    const rel = d.relationships[0];
    const posts = byName(d.tables, "posts");
    const users = byName(d.tables, "users");
    expect(rel.startTableId).toBe(posts.id);
    expect(rel.endTableId).toBe(users.id);
    expect(rel.fields).toHaveLength(1);
    expect(rel.updateConstraint).toBe("No action");
    expect(rel.deleteConstraint).toBe("Cascade");
  });

  it("imports a composite inline FOREIGN KEY (multi-column)", () => {
    const d = imp(
      `CREATE TABLE parent (a INTEGER, b INTEGER, PRIMARY KEY(a, b));
       CREATE TABLE child (
         x INTEGER,
         y INTEGER,
         FOREIGN KEY (x, y) REFERENCES parent(a, b)
       );`,
    );
    expect(d.relationships).toHaveLength(1);
    expect(d.relationships[0].fields).toHaveLength(2);
  });

  // normalize.js quirk: node-sql-parser treats a leading `status <type>` as the
  // reserved MariaDB STATUS keyword; normalizeSQLForParser backtick-quotes it.
  describe("status keyword normalize quirk", () => {
    const ML = `CREATE TABLE t (
  status VARCHAR(20) NOT NULL,
  name TEXT
);`;

    it("imports a column literally named `status`", () => {
      const t = byName(imp(ML).tables, "t");
      expect(t.fields.map((f) => f.name)).toEqual(["status", "name"]);
      expect(field(t, "status").notNull).toBe(true);
    });

    it("would fail to parse WITHOUT the normalize step (proves it is needed)", () => {
      expect(() =>
        new Parser().astify(ML, { database: DB.MARIADB }),
      ).toThrow();
      // ...and normalize rewrites the offending identifier.
      expect(normalizeSQLForParser(ML, DB.MARIADB)).toContain("`status`");
    });
  });
});
