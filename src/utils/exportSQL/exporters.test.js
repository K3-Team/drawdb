import { describe, it, expect } from "vitest";
import { exportSQL } from "./index";
import {
  jsonToMySQL,
  jsonToPostgreSQL,
  jsonToSQLite,
  jsonToMariaDB,
  jsonToSQLServer,
  jsonToOracleSQL,
} from "./generic";
import { generateMigrationSQL } from "../migrations/diffToSQL";
import { DB } from "../../data/constants";

// Contains every identifier delimiter used by any supported dialect.
const EVIL = 'users`"]; DROP DATABASE prod; -- ';

function diagram(database) {
  const field = (id) => ({
    id,
    name: EVIL,
    type: "VARCHAR",
    size: "255",
    notNull: false,
    primary: false,
    unique: false,
    increment: false,
    isArray: false,
    default: "",
    check: "",
    comment: "",
    values: [],
  });

  return {
    database,
    tables: [
      {
        id: 1,
        name: EVIL,
        comment: "",
        inherits: [],
        uniqueConstraints: [{ name: EVIL, fields: [EVIL] }],
        fields: [{ ...field(10), primary: true, notNull: true }],
        indices: [{ name: EVIL, unique: false, fields: [EVIL] }],
      },
      {
        id: 2,
        name: "other",
        comment: "",
        inherits: [],
        uniqueConstraints: [],
        fields: [field(20)],
        indices: [],
      },
    ],
    references: [
      {
        id: 100,
        name: EVIL,
        startTableId: 2,
        startFieldId: 20,
        endTableId: 1,
        endFieldId: 10,
        updateConstraint: "; DROP TABLE t; --",
        deleteConstraint: "Cascade",
      },
    ],
    types: [],
    enums: [],
  };
}

// The payload must appear only in its escaped form: every occurrence of the
// dialect's closing delimiter doubled, so the identifier can never be closed
// early. The raw payload must never survive anywhere in the output.
function expectNoBreakout(sql, closer) {
  const escaped = EVIL.split(closer).join(closer + closer);
  expect(sql).toContain(escaped);
  expect(sql).not.toContain(EVIL);
}

const CLOSERS = {
  [DB.MYSQL]: "`",
  [DB.MARIADB]: "`",
  [DB.POSTGRES]: '"',
  [DB.SQLITE]: '"',
  [DB.ORACLESQL]: '"',
  [DB.MSSQL]: "]",
};

describe("exportSQL neutralises a hostile identifier", () => {
  for (const [db, closer] of Object.entries(CLOSERS)) {
    it(`${db} doubles the closing delimiter and sanitises FK actions`, () => {
      const sql = exportSQL(diagram(db));
      expectNoBreakout(sql, closer);
      expect(sql).not.toContain("ON UPDATE ; DROP TABLE t");
      expect(sql).toContain("ON UPDATE NO ACTION ON DELETE CASCADE");
    });
  }
});

describe("generic (database-less) exporters neutralise a hostile identifier", () => {
  const cases = [
    [jsonToMySQL, "`"],
    [jsonToPostgreSQL, '"'],
    [jsonToSQLite, '"'],
    [jsonToMariaDB, "`"],
    [jsonToSQLServer, "]"],
    [jsonToOracleSQL, '"'],
  ];

  for (const [fn, closer] of cases) {
    it(`${fn.name} doubles the closing delimiter`, () => {
      expectNoBreakout(fn(diagram(DB.GENERIC)), closer);
    });
  }
});

describe("generateMigrationSQL neutralises a hostile identifier", () => {
  it("escapes identifiers in generated CREATE TABLE", () => {
    const to = diagram(DB.POSTGRES);
    const { up } = generateMigrationSQL(
      { "tables[name=x]": { to: to.tables[0], from: null } },
      DB.POSTGRES,
      { from: diagram(DB.POSTGRES), to },
    );
    expectNoBreakout(up, '"');
  });
});

// MSSQL emits object names into sp_addextendedproperty / sp_rename as string
// literals rather than as bracketed identifiers, so a name containing a single
// quote must be doubled or it closes the literal.
describe("generateMigrationSQL escapes MSSQL string literals", () => {
  const QUOTED = "o'brien'; DROP TABLE t; --";
  const ESCAPED = QUOTED.split("'").join("''");

  const table = {
    id: 1,
    name: QUOTED,
    comment: "note",
    inherits: [],
    uniqueConstraints: [],
    indices: [],
    fields: [
      {
        id: 10,
        name: QUOTED,
        type: "VARCHAR",
        size: "255",
        notNull: false,
        primary: false,
        unique: false,
        increment: false,
        default: "",
        check: "",
        comment: "note",
        values: [],
      },
    ],
  };

  // The generator recovers table/column names by parsing the diff path, so the
  // payload has to live in the key as well as in the diagram objects.
  const key = `tables[id=1,name=${QUOTED}]`;
  const fieldKey = `fields[id=10,name=${QUOTED},type=VARCHAR]`;

  const cases = [
    ["new table comment", { [key]: { to: table, from: null } }],
    ["table comment change", { [`${key}#comment`]: { to: "note", from: "" } }],
    ["table rename", { [`${key}#name`]: { from: QUOTED, to: QUOTED } }],
    [
      "column comment change",
      { [`${key}#${fieldKey}#comment`]: { to: "note", from: "" } },
    ],
    [
      "column rename",
      { [`${key}#${fieldKey}#name`]: { from: QUOTED, to: QUOTED } },
    ],
  ];

  for (const [label, diff] of cases) {
    it(`${label} cannot close the N'...' literal`, () => {
      const { up } = generateMigrationSQL(diff, DB.MSSQL, {
        from: { tables: [] },
        to: { tables: [table] },
      });

      // Inside [bracketed identifiers] a bare ' is harmless, so drop those and
      // check what is left: every remaining occurrence must be doubled.
      const literals = up.replace(/\[[^\]]*\]/g, "[ident]");
      expect(literals).toContain(ESCAPED);
      expect(literals).not.toContain(QUOTED);
    });
  }
});

describe("CHECK expressions that can break the statement are refused", () => {
  it("throws instead of emitting an injected CHECK", () => {
    const d = diagram(DB.POSTGRES);
    d.tables[0].fields[0].check = "1=1); DROP TABLE t; --";
    expect(() => exportSQL(d)).toThrow(/CHECK expression/);
  });
});
