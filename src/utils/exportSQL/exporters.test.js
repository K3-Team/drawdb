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
import { parseDefault } from "./shared";
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
  // The @value= argument needs an apostrophe too: it used to be escaped twice
  // (escapeQuotes already doubles), turning o'brien into o''''brien.
  const COMMENT = "o'brien's note";
  const COMMENT_ESCAPED = COMMENT.split("'").join("''");

  const table = {
    id: 1,
    name: QUOTED,
    comment: COMMENT,
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
        comment: COMMENT,
        values: [],
      },
    ],
  };

  // The generator recovers table/column names by parsing the diff path, so the
  // payload has to live in the key as well as in the diagram objects.
  const key = `tables[id=1,name=${QUOTED}]`;
  const fieldKey = `fields[id=10,name=${QUOTED},type=VARCHAR]`;

  // [hasComment] marks the cases that emit an @value= argument.
  const cases = [
    ["new table comment", { [key]: { to: table, from: null } }, true],
    [
      "table comment change",
      { [`${key}#comment`]: { to: COMMENT, from: "" } },
      true,
    ],
    ["table rename", { [`${key}#name`]: { from: QUOTED, to: QUOTED } }, false],
    [
      "column comment change",
      { [`${key}#${fieldKey}#comment`]: { to: COMMENT, from: "" } },
      true,
    ],
    [
      "column rename",
      { [`${key}#${fieldKey}#name`]: { from: QUOTED, to: QUOTED } },
      false,
    ],
  ];

  for (const [label, diff, hasComment] of cases) {
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

      if (hasComment) {
        // Doubled exactly once — not quadrupled by a second escape pass.
        expect(literals).toContain(COMMENT_ESCAPED);
        expect(literals).not.toContain(COMMENT_ESCAPED.split("'").join("''"));
      }
    });
  }
});

// parseDefault emits field.default verbatim when isFunction() says it is a
// call, so an unanchored isFunction let a payload ending in "now()" skip
// quoting entirely.
describe("parseDefault quotes a default that only ends in a call", () => {
  it("does not treat a payload ending in now() as a function", () => {
    const field = { default: "x'; DROP TABLE t; -- now()", type: "VARCHAR" };
    expect(parseDefault(field, DB.MYSQL)).toBe("'x''; DROP TABLE t; -- now()'");
  });

  it("still emits a genuine function call unquoted", () => {
    expect(parseDefault({ default: "now()", type: "VARCHAR" }, DB.MYSQL)).toBe(
      "now()",
    );
  });
});

describe("CHECK expressions that can break the statement are refused", () => {
  const payloads = [
    ["statement terminator", "1=1); DROP TABLE t; --"],
    // '#' is a MySQL/MariaDB line comment, hiding the generated ')'.
    ["hash line comment", "1=1), evil_col INT DEFAULT 1 # "],
    // Needs no blocked token at all: it just re-balances the CHECK( group.
    ["unbalanced parentheses", "1=1), evil_col INT, CHECK(1=1"],
  ];

  // An exporter only emits CHECK for types whose metadata sets hasCheck, and
  // Oracle has no VARCHAR (it is VARCHAR2), so pick a checkable type per
  // dialect -- otherwise the guard is never reached and the test is vacuous.
  for (const db of Object.keys(CLOSERS)) {
    const type = db === DB.ORACLESQL ? "VARCHAR2" : "VARCHAR";
    for (const [label, check] of payloads) {
      it(`${db} refuses a ${label} payload`, () => {
        const d = diagram(db);
        d.tables[0].fields[0].type = type;
        d.tables[0].fields[0].check = check;
        expect(() => exportSQL(d)).toThrow(/CHECK expression/);
      });
    }
  }

  it("omits the expression for a type that does not support CHECK", () => {
    const d = diagram(DB.ORACLESQL);
    d.tables[0].fields[0].check = "1=1), evil_col INT, CHECK(1=1";
    expect(exportSQL(d)).not.toContain("evil_col");
  });

  it("still accepts an ordinary parenthesised expression", () => {
    const d = diagram(DB.POSTGRES);
    d.tables[0].fields[0].check = "(age > 0) AND (age < 200)";
    expect(exportSQL(d)).toContain("CHECK((age > 0) AND (age < 200))");
  });
});

describe("non-string enum values export without throwing", () => {
  it("quotes numeric ENUM values instead of raising a TypeError", () => {
    const d = diagram(DB.MYSQL);
    d.tables[0].fields[0].type = "ENUM";
    d.tables[0].fields[0].values = [1, 2];
    expect(exportSQL(d)).toContain("ENUM('1', '2')");
  });
});
