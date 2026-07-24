import { describe, it, expect } from "vitest";
import { generateMigrationSQL } from "./diffToSQL";
import { DB } from "../../data/constants";

// exporters.test.js already covers generateMigrationSQL's identifier escaping.
// These add functional coverage: a create/drop diff must produce the matching
// forward (up) and reverse (down) DDL. Migrations that regress corrupt data.

const table = (id, name) => ({
  id,
  name,
  comment: "",
  inherits: [],
  uniqueConstraints: [],
  indices: [],
  fields: [
    {
      id: id * 10,
      name: "id",
      type: "INT",
      size: "",
      notNull: true,
      primary: true,
      unique: false,
      increment: true,
      default: "",
      check: "",
      comment: "",
      values: [],
    },
  ],
});

const createTable = /CREATE\s+(OR REPLACE\s+)?TABLE/i;

describe("generateMigrationSQL create/drop", () => {
  for (const db of [DB.POSTGRES, DB.MYSQL, DB.SQLITE]) {
    it(`${db}: adding a table emits CREATE up / DROP down`, () => {
      const to = { tables: [table(1, "users")] };
      const from = { tables: [] };
      const { up, down } = generateMigrationSQL(
        { "tables[id=1,name=users]": { to: to.tables[0], from: null } },
        db,
        { from, to },
      );
      expect(up).toMatch(createTable);
      expect(up).toContain("users");
      expect(down).toMatch(/DROP TABLE/i);
    });

    it(`${db}: dropping a table emits DROP up / CREATE down`, () => {
      const from = { tables: [table(1, "users")] };
      const to = { tables: [] };
      const { up, down } = generateMigrationSQL(
        { "tables[id=1,name=users]": { to: null, from: from.tables[0] } },
        db,
        { from, to },
      );
      expect(up).toMatch(/DROP TABLE/i);
      expect(down).toMatch(createTable);
    });
  }
});

// Regression: MySQL/MariaDB MODIFY COLUMN replaces the whole column definition,
// so a partial MODIFY silently drops DEFAULT/AUTO_INCREMENT/etc. Changing one
// attribute (here a comment) must re-emit the full definition, keeping DEFAULT.
describe("generateMigrationSQL preserves attributes on MySQL MODIFY", () => {
  for (const db of [DB.MYSQL, DB.MARIADB]) {
    it(`${db}: comment change keeps NOT NULL and DEFAULT`, () => {
      const field = {
        id: 10,
        name: "age",
        type: "INT",
        size: "",
        notNull: true,
        primary: false,
        unique: false,
        increment: false,
        default: "5",
        check: "",
        comment: "",
        values: [],
      };
      const from = {
        tables: [{ ...table(1, "users"), fields: [{ ...field }] }],
      };
      const to = {
        tables: [
          { ...table(1, "users"), fields: [{ ...field, comment: "an age" }] },
        ],
      };
      const { up } = generateMigrationSQL(
        {
          "tables[id=1,name=users]#fields[id=10,name=age,type=INT]#comment": {
            from: "",
            to: "an age",
          },
        },
        db,
        { from, to },
      );
      expect(up).toMatch(/MODIFY COLUMN/i);
      expect(up).toContain("NOT NULL");
      expect(up).toContain("DEFAULT 5"); // would be dropped by a partial MODIFY
      expect(up).toContain("COMMENT 'an age'");
    });
  }
});
