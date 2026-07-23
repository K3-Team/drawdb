import { describe, it, expect } from "vitest";
import {
  quoteIdentifier,
  quoterFor,
  safeConstraint,
  assertNoStatementBreak,
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

  it("rejects statement terminators and comment introducers", () => {
    expect(() => assertNoStatementBreak("1=1; DROP TABLE t")).toThrow();
    expect(() => assertNoStatementBreak("1=1 -- x")).toThrow();
    expect(() => assertNoStatementBreak("1=1 /* x */")).toThrow();
  });
});
