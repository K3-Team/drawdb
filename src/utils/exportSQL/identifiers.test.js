import { describe, it, expect } from "vitest";
import {
  quoteIdentifier,
  quoterFor,
  safeConstraint,
  assertNoStatementBreak,
  assertSafeDefault,
} from "./identifiers";
import { DB, Constraint } from "../../data/constants";

describe("quoteIdentifier", () => {
  it("wraps mysql identifiers in backticks", () => {
    expect(quoteIdentifier("users", DB.MYSQL)).toBe("`users`");
  });

  it("doubles embedded backticks so the identifier cannot be closed", () => {
    expect(quoteIdentifier("users`; DROP DATABASE prod; -- ", DB.MYSQL)).toBe(
      "`users``; DROP DATABASE prod; -- `",
    );
  });

  it("doubles embedded double quotes for postgres", () => {
    expect(quoteIdentifier('a" ; DROP TABLE t; --', DB.POSTGRES)).toBe(
      '"a"" ; DROP TABLE t; --"',
    );
  });

  it("doubles embedded closing brackets for mssql", () => {
    expect(quoteIdentifier("a]; DROP TABLE t; --", DB.MSSQL)).toBe(
      "[a]]; DROP TABLE t; --]",
    );
  });

  it("leaves safe generic identifiers bare", () => {
    expect(quoteIdentifier("users", DB.GENERIC)).toBe("users");
  });

  it("quotes unsafe generic identifiers", () => {
    expect(quoteIdentifier("my table", DB.GENERIC)).toBe('"my table"');
  });

  it("coerces non-strings without throwing", () => {
    expect(quoteIdentifier(undefined, DB.MYSQL)).toBe("``");
  });
});

describe("quoterFor", () => {
  it("returns a single-argument quoter bound to a dialect", () => {
    const q = quoterFor(DB.MYSQL);
    expect(q("a`b")).toBe("`a``b`");
  });
});

describe("safeConstraint", () => {
  it("passes known constraints through uppercased", () => {
    expect(safeConstraint(Constraint.CASCADE)).toBe("CASCADE");
    expect(safeConstraint(Constraint.SET_NULL)).toBe("SET NULL");
  });

  it("falls back to NO ACTION for unknown input", () => {
    expect(safeConstraint("; DROP TABLE t; --")).toBe("NO ACTION");
    expect(safeConstraint(undefined)).toBe("NO ACTION");
  });
});

describe("assertNoStatementBreak", () => {
  it("allows ordinary check expressions", () => {
    expect(assertNoStatementBreak("age > 0")).toBe("age > 0");
  });

  it("allows balanced parentheses and function calls", () => {
    expect(assertNoStatementBreak("(a > 0) AND (b < length(c))")).toBe(
      "(a > 0) AND (b < length(c))",
    );
  });

  it("rejects statement terminators and comment introducers", () => {
    expect(() => assertNoStatementBreak("1=1; DROP TABLE t")).toThrow();
    expect(() => assertNoStatementBreak("1=1 -- x")).toThrow();
    expect(() => assertNoStatementBreak("1=1 /* x */")).toThrow();
  });

  it("rejects '#', a MySQL line comment that can hide the closing paren", () => {
    expect(() =>
      assertNoStatementBreak("1=1), evil_col INT DEFAULT 1 # "),
    ).toThrow();
  });

  it("rejects a newline, which lets MSSQL start a new GO batch", () => {
    expect(() =>
      assertNoStatementBreak("1=1\nGO\nDROP TABLE users\nGO\n1=1"),
    ).toThrow();
    expect(() => assertNoStatementBreak("1=1\r\nGO\r\n1=1")).toThrow();
  });

  it("rejects unbalanced parentheses, which need no blocked token", () => {
    // Closes CHECK( early and re-opens it, so the output stays syntactically
    // valid while smuggling in an extra column.
    expect(() =>
      assertNoStatementBreak("1=1), evil_col INT, CHECK(1=1"),
    ).toThrow();
    expect(() => assertNoStatementBreak("1=1)")).toThrow();
    expect(() => assertNoStatementBreak("(1=1")).toThrow();
  });

  it("names the offending expression so the user can fix it", () => {
    expect(() => assertNoStatementBreak("1=1; DROP TABLE t")).toThrow(
      /Refusing to generate SQL for: 1=1; DROP TABLE t/,
    );
  });

  it("truncates a pathologically long expression", () => {
    const input = ";".padEnd(500, "x");
    let message = "";
    try {
      assertNoStatementBreak(input);
    } catch (e) {
      message = e.message;
    }
    expect(message).toContain("…");
    // Only the echoed expression is capped, so compare against the input
    // rather than a fixed budget that the wording would keep invalidating.
    expect(message).not.toContain(input);
    expect(message.length).toBeLessThan(input.length);
  });
});

describe("assertSafeDefault", () => {
  it("allows legitimate function defaults", () => {
    for (const d of [
      "now()",
      "CURRENT_TIMESTAMP()",
      "nextval('seq')",
      "now(6)",
      "gen_random_uuid()",
      "to_date('2020-01-01','YYYY-MM-DD')",
    ]) {
      expect(assertSafeDefault(d)).toBe(d);
    }
  });

  it("allows keywords and bare literals", () => {
    for (const d of ["NULL", "TRUE", "CURRENT_TIMESTAMP", "0", "-1", "3.14"]) {
      expect(assertSafeDefault(d)).toBe(d);
    }
  });

  it("rejects SQL smuggled inside a function call's parentheses", () => {
    // Anchoring isFunction fixed the outer shape; [^)]* still allowed this.
    expect(() => assertSafeDefault("f(;DROP TABLE users;SELECT 1 --)")).toThrow(
      /function DEFAULT/,
    );
  });

  it("rejects a bare default that starts another column definition", () => {
    // Reached via the !hasQuotes branch on numeric types: no function shape
    // and no blocked token, just a comma.
    expect(() => assertSafeDefault("1, evil INT DEFAULT 2")).toThrow(
      /unquoted DEFAULT/,
    );
  });

  it("rejects comment introducers in either position", () => {
    expect(() => assertSafeDefault("f('a' -- )")).toThrow();
    expect(() => assertSafeDefault("1--2")).toThrow();
  });
});
