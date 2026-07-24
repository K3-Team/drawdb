import { describe, it, expect } from "vitest";
import { Parser } from "node-sql-parser";
import { importSQL } from "./index";
import { normalizeSQLForParser, parserDatabase } from "./normalize";
import { DB } from "../../data/constants";

// Oracle (fromOracleSQL) is intentionally not covered here: it is a beta
// dialect and the bundled oracle-sql-parser rejects even basic CREATE TABLE
// DDL, so any fixture would test the third-party parser, not our importer.

// Round-trip each dialect: raw DDL -> AST (the same parsers Modal.jsx uses) ->
// importSQL -> assert diagram structure. Only escapeRegExp was tested before;
// the actual per-dialect importers (fromMySQL/fromPostgres/...) had no coverage.

function parse(sql, database) {
  const normalized = normalizeSQLForParser(sql, database);
  return new Parser().astify(normalized, { database: parserDatabase(database) });
}

const byName = (tables, name) =>
  tables.find((t) => t.name.toLowerCase() === name.toLowerCase());

describe("importSQL per-dialect importers", () => {
  const cases = [
    {
      db: DB.MYSQL,
      sql: "CREATE TABLE users (id INT PRIMARY KEY, email VARCHAR(255) NOT NULL);",
    },
    {
      db: DB.MARIADB,
      sql: "CREATE TABLE users (id INT PRIMARY KEY, email VARCHAR(255) NOT NULL);",
    },
    {
      db: DB.POSTGRES,
      sql: "CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL);",
    },
    {
      db: DB.SQLITE,
      sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL);",
    },
    {
      db: DB.MSSQL,
      sql: "CREATE TABLE users (id INT PRIMARY KEY, email VARCHAR(255) NOT NULL);",
    },
  ];

  for (const { db, sql } of cases) {
    it(`${db}: parses a table with its fields`, () => {
      const diagram = importSQL(parse(sql, db), db);
      expect(Array.isArray(diagram.tables)).toBe(true);
      const users = byName(diagram.tables, "users");
      expect(users, `table 'users' for ${db}`).toBeTruthy();
      const names = users.fields.map((f) => f.name.toLowerCase());
      expect(names).toContain("id");
      expect(names).toContain("email");
      expect(users.fields.find((f) => f.name.toLowerCase() === "id").primary).toBe(true);
    });
  }

  it("mysql: extracts a foreign-key relationship", () => {
    const sql = `
      CREATE TABLE users (id INT PRIMARY KEY);
      CREATE TABLE posts (
        id INT PRIMARY KEY,
        author_id INT,
        FOREIGN KEY (author_id) REFERENCES users(id)
      );`;
    const diagram = importSQL(parse(sql, DB.MYSQL), DB.MYSQL);
    expect(diagram.tables.length).toBe(2);
    expect(diagram.relationships.length).toBe(1);
    const rel = diagram.relationships[0];
    // The relationship connects posts -> users on real table/field references.
    const posts = byName(diagram.tables, "posts");
    const users = byName(diagram.tables, "users");
    const ids = [posts.id, users.id].map(String);
    expect(ids).toContain(String(rel.startTableId));
    expect(ids).toContain(String(rel.endTableId));
  });
});
