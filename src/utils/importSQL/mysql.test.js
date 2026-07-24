import { describe, it, expect } from "vitest";
import { parseAndImport } from "../sqlTestKit";
import { DB } from "../../data/constants";

// CREATE TABLE import feature matrix for MySQL (fromMySQL). Each case pushes DDL
// through the exact app path (normalizeSQLForParser -> node-sql-parser ->
// importSQL) and asserts the resulting diagram model.
//
// Note on types: dbToTypes[MYSQL] has no INT entry, so affinity maps INT ->
// INTEGER. Every imported INT column therefore has type "INTEGER".

const importMySQL = (sql) => parseAndImport(sql, DB.MYSQL);
const byName = (tables, name) =>
  tables.find((t) => t.name.toLowerCase() === name.toLowerCase());
const field = (table, name) =>
  table.fields.find((f) => f.name.toLowerCase() === name.toLowerCase());

describe("fromMySQL — column feature matrix", () => {
  it("maps INT to the INTEGER affinity type", () => {
    const d = importMySQL("CREATE TABLE t (a INT);");
    expect(field(byName(d.tables, "t"), "a").type).toBe("INTEGER");
  });

  it("captures NOT NULL, and leaves an unspecified column nullable", () => {
    const d = importMySQL(
      "CREATE TABLE t (a INT NOT NULL, b INT);",
    );
    const t = byName(d.tables, "t");
    expect(field(t, "a").notNull).toBe(true);
    expect(field(t, "b").notNull).toBe(false);
  });

  it("does not treat an explicit NULL as NOT NULL", () => {
    const d = importMySQL("CREATE TABLE t (a INT NULL);");
    expect(field(byName(d.tables, "t"), "a").notNull).toBe(false);
  });

  it("captures a scalar DEFAULT", () => {
    const d = importMySQL(
      "CREATE TABLE t (a INT DEFAULT 5, b VARCHAR(20) DEFAULT 'hi');",
    );
    const t = byName(d.tables, "t");
    expect(field(t, "a").default).toBe("5");
    expect(field(t, "b").default).toBe("hi");
  });

  it("captures a function/keyword DEFAULT (CURRENT_TIMESTAMP)", () => {
    const d = importMySQL(
      "CREATE TABLE t (created TIMESTAMP DEFAULT CURRENT_TIMESTAMP);",
    );
    expect(field(byName(d.tables, "t"), "created").default).toMatch(
      /CURRENT_TIMESTAMP/i,
    );
  });

  it("captures an inline column CHECK", () => {
    const d = importMySQL("CREATE TABLE t (age INT CHECK(age >= 0));");
    // buildSQLFromAST backtick-quotes the column reference for MySQL.
    expect(field(byName(d.tables, "t"), "age").check).toBe("`age` >= 0");
  });

  it("captures an inline UNIQUE column", () => {
    const d = importMySQL("CREATE TABLE t (email VARCHAR(255) UNIQUE);");
    expect(field(byName(d.tables, "t"), "email").unique).toBe(true);
  });

  it("captures AUTO_INCREMENT as increment", () => {
    const d = importMySQL(
      "CREATE TABLE t (id INT NOT NULL AUTO_INCREMENT, PRIMARY KEY(id));",
    );
    expect(field(byName(d.tables, "t"), "id").increment).toBe(true);
  });

  it("captures UNSIGNED (from the parser suffix)", () => {
    const d = importMySQL(
      "CREATE TABLE t (a INT UNSIGNED, b INT, c INT UNSIGNED ZEROFILL);",
    );
    const t = byName(d.tables, "t");
    expect(field(t, "a").unsigned).toBe(true);
    expect(field(t, "b").unsigned).toBe(false);
    expect(field(t, "c").unsigned).toBe(true);
  });

  it("captures a column COMMENT", () => {
    const d = importMySQL(
      "CREATE TABLE t (a INT COMMENT 'the a column');",
    );
    expect(field(byName(d.tables, "t"), "a").comment).toBe("the a column");
  });

  it("captures ENUM members into field.values", () => {
    const d = importMySQL(
      "CREATE TABLE t (role ENUM('admin','user','guest'));",
    );
    const f = field(byName(d.tables, "t"), "role");
    expect(f.type).toBe("ENUM");
    expect(f.values).toEqual(["admin", "user", "guest"]);
  });

  it("captures SET members into field.values", () => {
    const d = importMySQL("CREATE TABLE t (tags SET('x','y','z'));");
    const f = field(byName(d.tables, "t"), "tags");
    expect(f.type).toBe("SET");
    expect(f.values).toEqual(["x", "y", "z"]);
  });

  it("captures a sized VARCHAR", () => {
    const d = importMySQL("CREATE TABLE t (name VARCHAR(64));");
    expect(field(byName(d.tables, "t"), "name").size).toBe(64);
  });

  it("captures a DECIMAL precision as size", () => {
    const d = importMySQL("CREATE TABLE t (amount DECIMAL(10,2));");
    expect(field(byName(d.tables, "t"), "amount").size).toBe("10,2");
  });
});

describe("fromMySQL — table-level constraints", () => {
  it("captures an inline PRIMARY KEY column", () => {
    const d = importMySQL("CREATE TABLE t (id INT PRIMARY KEY);");
    expect(field(byName(d.tables, "t"), "id").primary).toBe(true);
  });

  it("captures a single-column PRIMARY KEY constraint", () => {
    const d = importMySQL(
      "CREATE TABLE t (id INT, name VARCHAR(10), PRIMARY KEY(id));",
    );
    const t = byName(d.tables, "t");
    expect(field(t, "id").primary).toBe(true);
    expect(field(t, "name").primary).toBe(false);
  });

  it("captures a composite PRIMARY KEY", () => {
    const d = importMySQL(
      "CREATE TABLE t (a INT, b INT, c INT, PRIMARY KEY(a, b));",
    );
    const t = byName(d.tables, "t");
    expect(field(t, "a").primary).toBe(true);
    expect(field(t, "b").primary).toBe(true);
    expect(field(t, "c").primary).toBe(false);
  });

  it("captures a table UNIQUE constraint", () => {
    const d = importMySQL(
      "CREATE TABLE t (a INT, b INT, CONSTRAINT uq_ab UNIQUE (a, b));",
    );
    const t = byName(d.tables, "t");
    expect(t.uniqueConstraints.length).toBe(1);
    expect(t.uniqueConstraints[0].fields).toEqual(["a", "b"]);
  });

  it("captures a table COMMENT", () => {
    const d = importMySQL(
      "CREATE TABLE t (a INT) COMMENT='a table comment';",
    );
    expect(byName(d.tables, "t").comment).toBe("a table comment");
  });
});

describe("fromMySQL — indices", () => {
  it("captures a standalone CREATE INDEX", () => {
    const d = importMySQL(
      "CREATE TABLE t (a INT, b INT);\nCREATE INDEX idx_a ON t (a);",
    );
    const t = byName(d.tables, "t");
    expect(t.indices.length).toBe(1);
    expect(t.indices[0].name).toBe("idx_a");
    expect(t.indices[0].unique).toBe(false);
    expect(t.indices[0].fields).toEqual(["a"]);
  });

  it("captures a composite UNIQUE index", () => {
    const d = importMySQL(
      "CREATE TABLE t (a INT, b INT);\nCREATE UNIQUE INDEX idx_ab ON t (a, b);",
    );
    const idx = byName(d.tables, "t").indices[0];
    expect(idx.unique).toBe(true);
    expect(idx.fields).toEqual(["a", "b"]);
  });
});

describe("fromMySQL — foreign keys", () => {
  it("captures an inline single-column FK with ON DELETE", () => {
    const d = importMySQL(`
      CREATE TABLE users (id INT PRIMARY KEY);
      CREATE TABLE posts (
        id INT PRIMARY KEY,
        author_id INT,
        FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
      );`);
    expect(d.relationships.length).toBe(1);
    const rel = d.relationships[0];
    expect(rel.deleteConstraint).toBe("Cascade");
    expect(rel.updateConstraint).toBe("No action");
    const posts = byName(d.tables, "posts");
    const users = byName(d.tables, "users");
    const ids = [posts.id, users.id].map(String);
    expect(ids).toContain(String(rel.startTableId));
    expect(ids).toContain(String(rel.endTableId));
    expect(rel.fields.length).toBe(1);
  });

  it("captures a composite FK (all column pairs)", () => {
    const d = importMySQL(`
      CREATE TABLE parent (a INT, b INT, PRIMARY KEY (a, b));
      CREATE TABLE child (
        x INT, y INT,
        FOREIGN KEY (x, y) REFERENCES parent(a, b) ON UPDATE CASCADE
      );`);
    expect(d.relationships.length).toBe(1);
    const rel = d.relationships[0];
    expect(rel.fields.length).toBe(2);
    expect(rel.updateConstraint).toBe("Cascade");
  });

  it("captures an FK added via ALTER TABLE", () => {
    const d = importMySQL(`
      CREATE TABLE users (id INT PRIMARY KEY);
      CREATE TABLE posts (id INT PRIMARY KEY, author_id INT);
      ALTER TABLE posts ADD FOREIGN KEY (author_id) REFERENCES users(id) ON UPDATE SET NULL ON DELETE RESTRICT;`);
    expect(d.relationships.length).toBe(1);
    const rel = d.relationships[0];
    expect(rel.updateConstraint).toBe("Set null");
    expect(rel.deleteConstraint).toBe("Restrict");
  });
});

describe("fromMySQL — backtick-quoted identifiers", () => {
  it("parses backtick-quoted table and column names", () => {
    const d = importMySQL(
      "CREATE TABLE `my table` (`select` INT, `weird``name` INT);",
    );
    const t = byName(d.tables, "my table");
    expect(t).toBeTruthy();
    expect(field(t, "select")).toBeTruthy();
  });
});

// shared.js buildSQLFromAST now renders an IN-list as (a, b, c) instead of
// joining with " AND ".
describe("fromMySQL — IN-list CHECK", () => {
  it("preserves an IN-list CHECK as an IN clause", () => {
    const d = importMySQL("CREATE TABLE t (n INT CHECK(n IN (1,2,3)));");
    expect(field(byName(d.tables, "t"), "n").check).toBe("`n` IN (1, 2, 3)");
  });
});
