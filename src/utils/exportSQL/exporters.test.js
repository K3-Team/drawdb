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
import { parseDefault, exportFieldComment } from "./shared";
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
    // Balanced and token-free: GO splits the MSSQL script into batches, and
    // the DROP batch succeeds even though the batches around it fail.
    ["GO batch separator", "1=1\nGO\nDROP TABLE users\nGO\n1=1"],
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

// parseDefault interpolates the value unquoted on three branches, so a
// hostile default reaches the script without ever touching an identifier.
describe("DEFAULT values that can break the statement are refused", () => {
  it("refuses SQL smuggled inside a function default", () => {
    const d = diagram(DB.MYSQL);
    d.tables[0].fields[0].default = "f(;DROP TABLE users;SELECT 1 --)";
    expect(() => exportSQL(d)).toThrow(/function DEFAULT/);
  });

  it("refuses a numeric default that opens another column", () => {
    const d = diagram(DB.MYSQL);
    d.tables[0].fields[0].type = "INT";
    d.tables[0].fields[0].default = "1, evil INT DEFAULT 2";
    expect(() => exportSQL(d)).toThrow(/unquoted DEFAULT/);
  });

  it("still emits legitimate function and literal defaults", () => {
    const d = diagram(DB.MYSQL);
    d.tables[0].fields[0].default = "now()";
    expect(exportSQL(d)).toContain("DEFAULT now()");

    const n = diagram(DB.MYSQL);
    n.tables[0].fields[0].type = "INT";
    n.tables[0].fields[0].default = "-1";
    expect(exportSQL(n)).toContain("DEFAULT -1");
  });

  it("still quotes an ordinary string default", () => {
    const d = diagram(DB.MYSQL);
    d.tables[0].fields[0].default = "hello world";
    expect(exportSQL(d)).toContain("DEFAULT 'hello world'");
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

// field.size and field.type are interpolated raw -- they have to stay SQL --
// so each carries a shape guard instead of quoting.
describe("structural values that can graft a column are refused", () => {
  const sized = {
    [DB.MYSQL]: "VARCHAR",
    [DB.MARIADB]: "VARCHAR",
    [DB.POSTGRES]: "VARCHAR",
    [DB.MSSQL]: "VARCHAR",
    [DB.ORACLESQL]: "VARCHAR2",
  };

  for (const [db, type] of Object.entries(sized)) {
    it(`${db} refuses a size that closes the type parentheses`, () => {
      const d = diagram(db);
      d.tables[0].fields[0].type = type;
      d.tables[0].fields[0].size = "255), evil_col INT DEFAULT (1";
      expect(() => exportSQL(d)).toThrow(/column size/);
    });
  }

  for (const db of Object.keys(CLOSERS)) {
    it(`${db} refuses a type that grafts another column`, () => {
      const d = diagram(db);
      d.tables[0].fields[0].type = "VARCHAR(255), evil_col INT";
      expect(() => exportSQL(d)).toThrow(/type name|commas inside/);
    });
  }

  it("still emits ordinary sizes and multi-word types", () => {
    const d = diagram(DB.POSTGRES);
    d.tables[0].fields[0].type = "DECIMAL";
    d.tables[0].fields[0].size = "10,2";
    expect(exportSQL(d)).toContain("DECIMAL(10,2)");
  });
});

// Comment bodies are inert text, so they are neutralised rather than rejected:
// "*/" closes a block comment and a newline ends a line comment.
describe("comment bodies cannot escape their delimiters", () => {
  const BLOCK = "note */ ; DROP TABLE users; /*";
  const LINE = "note\nDROP TABLE users";

  for (const db of [DB.SQLITE, DB.ORACLESQL]) {
    it(`${db} keeps a block comment closed`, () => {
      const d = diagram(db);
      d.tables[0].fields[0].type = db === DB.ORACLESQL ? "VARCHAR2" : "VARCHAR";
      d.tables[0].comment = BLOCK;
      const sql = exportSQL(d);
      const block = sql.split("\n").find((l) => l.trimStart().startsWith("/*"));
      // The only "*/" in the block is its own terminator.
      expect(block.indexOf("*/")).toBe(block.length - 2);
      expect(block).toContain("* / ; DROP TABLE users");
    });
  }

  it("oraclesql keeps an inline line comment on one line", () => {
    const d = diagram(DB.ORACLESQL);
    d.tables[0].fields[0].type = "VARCHAR2";
    d.tables[0].fields[0].comment = LINE;
    const sql = exportSQL(d);
    // The payload must never start a line of its own.
    expect(sql.split("\n").some((l) => l.trim() === "DROP TABLE users")).toBe(
      false,
    );
  });

  it("puts every line of a multi-line comment behind its own --", () => {
    // A newline inside the COMMENT ON string literal is harmless; what
    // matters is the -- block, where an unescaped newline would end the
    // comment and leave the rest as executable SQL.
    expect(exportFieldComment(LINE)).toBe("\t-- note\n\t-- DROP TABLE users\n");
    expect(exportFieldComment("note\rDROP TABLE users")).toBe(
      "\t-- note\n\t-- DROP TABLE users\n",
    );
  });
});

describe("JSON_SCHEMA_VALID nests its layers safely", () => {
  it("escapes a quote in an enum value at both the JSON and SQL layer", () => {
    const obj = {
      database: DB.GENERIC,
      tables: [
        {
          id: 1,
          name: "t",
          comment: "",
          inherits: [],
          uniqueConstraints: [],
          indices: [],
          fields: [
            {
              id: 10,
              name: "c",
              type: "custom_t",
              size: "",
              notNull: false,
              primary: false,
              unique: false,
              increment: false,
              default: "",
              check: "",
              comment: "",
              values: [],
            },
          ],
        },
      ],
      references: [],
      enums: [],
      types: [
        {
          name: "custom_t",
          comment: "",
          fields: [
            {
              name: "f",
              type: "ENUM",
              values: ["a'\") ; DROP TABLE users; --"],
            },
          ],
        },
      ],
    };
    const sql = jsonToMySQL(obj);
    expect(sql).not.toContain("a'\") ; DROP TABLE users");
    // ' doubled for the SQL literal, " backslash-escaped for the JSON layer.
    expect(sql).toContain("a''");
    expect(sql).toContain('\\"');
  });
});

describe("postgres composite types are quoted like every other identifier", () => {
  it("quotes the type name and its attribute names", () => {
    const d = diagram(DB.POSTGRES);
    d.types = [
      {
        name: 'evil" ; DROP TABLE users; --',
        comment: "",
        fields: [{ name: 'a" b', type: "INT" }],
      },
    ];
    const sql = exportSQL(d);
    expect(sql).toContain('CREATE TYPE "evil"" ; DROP TABLE users; --"');
    expect(sql).toContain('"a"" b" INT');
  });
});

// getTypeString has fallthrough `return` sinks that no ${...} sweep can see:
// dbToTypes yields `false` for an unknown key, so the isSized/hasPrecision
// tests above them skip instead of throwing.
describe("getTypeString fallthrough returns are guarded", () => {
  const EVIL = "INT); DROP TABLE users; --";

  it("refuses an unknown type on the postgres fallthrough", () => {
    expect(() =>
      jsonToPostgreSQL({
        database: DB.GENERIC,
        references: [],
        enums: [],
        types: [],
        tables: [
          {
            id: 1,
            name: "t1",
            comment: "",
            inherits: [],
            uniqueConstraints: [],
            indices: [],
            fields: [
              {
                id: 10,
                name: "c1",
                type: EVIL,
                size: "",
                notNull: false,
                primary: false,
                unique: false,
                increment: false,
                default: "",
                check: "",
                comment: "",
                values: [],
              },
            ],
          },
        ],
      }),
    ).toThrow(/type name/);
  });

  it("refuses the same type through a composite type definition", () => {
    expect(() =>
      jsonToPostgreSQL({
        database: DB.GENERIC,
        references: [],
        enums: [],
        tables: [],
        types: [
          { name: "addr", comment: "", fields: [{ name: "f1", type: EVIL }] },
        ],
      }),
    ).toThrow(/type name/);
  });
});

// A CR splits an MSSQL batch exactly as an LF does.
describe("MSSQL literals cannot start a new GO batch", () => {
  it("collapses a carriage return in an extended-property value", () => {
    const d = diagram(DB.MSSQL);
    d.tables[0].comment = "desc\rGO\rDROP TABLE users\rGO\rx";
    const sql = exportSQL(d);
    expect(sql).not.toMatch(/[\r\n]\s*GO\s*[\r\n]\s*DROP TABLE users/);
    expect(sql).toContain("desc GO DROP TABLE users GO x");
  });

  it("collapses a newline in a migration extended-property name", () => {
    const { up } = generateMigrationSQL(
      {
        "tables[id=1,name=a\nGO\nDROP TABLE users\nGO\nb]#comment": {
          to: "n",
          from: "",
        },
      },
      DB.MSSQL,
      { from: { tables: [] }, to: { tables: [] } },
    );
    expect(up).not.toMatch(/[\r\n]\s*GO\s*[\r\n]/);
    expect(up).toContain("a GO DROP TABLE users GO b");
  });
});

// Oracle used to append `-- comment` after the column, commenting out the
// following `,` and the statement's `;`.
describe("oraclesql keeps its delimiters when comments are present", () => {
  const col = (id, name, comment) => ({
    id,
    name,
    type: "VARCHAR2",
    size: "255",
    notNull: true,
    primary: false,
    unique: false,
    increment: false,
    default: "",
    check: "",
    comment,
    values: [],
  });

  it("does not comment out the column separator or terminator", () => {
    const sql = exportSQL({
      database: DB.ORACLESQL,
      references: [],
      types: [],
      enums: [],
      tables: [
        {
          id: 1,
          name: "users",
          comment: "user accounts",
          inherits: [],
          uniqueConstraints: [],
          indices: [],
          fields: [col(10, "id", "pk"), col(11, "email", "contact")],
        },
      ],
    });

    // Every comment must own its whole line, so no delimiter follows one.
    for (const line of sql.split("\n")) {
      const c = line.indexOf("--");
      if (c === -1) continue;
      expect(line.slice(c)).not.toMatch(/[,;]\s*$/);
    }
    // The column separator and statement terminator both survive.
    expect(sql).toContain('"id" VARCHAR2(255) NOT NULL,');
    expect(sql).toContain(");");
  });
});
