import { DB, Constraint } from "../../data/constants";
import { isFunction } from "../utils";

const SAFE_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Each dialect closes an identifier with a specific delimiter. The SQL standard
// escape is to double that delimiter, NOT to backslash it.
const DELIMITERS = {
  [DB.MYSQL]: { open: "`", close: "`" },
  [DB.MARIADB]: { open: "`", close: "`" },
  [DB.POSTGRES]: { open: '"', close: '"' },
  [DB.SQLITE]: { open: '"', close: '"' },
  [DB.ORACLESQL]: { open: '"', close: '"' },
  [DB.MSSQL]: { open: "[", close: "]" },
};

export function quoteIdentifier(name, db) {
  const s = name == null ? "" : String(name);
  const delim = DELIMITERS[db];

  // GENERIC has no canonical delimiter; only quote when the name needs it.
  if (!delim) {
    return SAFE_IDENT_RE.test(s) ? s : `"${s.replace(/"/g, '""')}"`;
  }

  const escaped = s.split(delim.close).join(delim.close + delim.close);
  return `${delim.open}${escaped}${delim.close}`;
}

export function quoterFor(db) {
  return (name) => quoteIdentifier(name, db);
}

const ALLOWED_CONSTRAINTS = new Set(Object.values(Constraint));

export function safeConstraint(value) {
  return ALLOWED_CONSTRAINTS.has(value)
    ? String(value).toUpperCase()
    : "NO ACTION";
}

// '#' is a line comment in MySQL/MariaDB, so it can hide a trailing ')'.
// Newlines are rejected outright: MSSQL's `GO` is a batch separator rather
// than a statement separator, so "1=1\nGO\nDROP TABLE users\nGO\n1=1" splits
// the emitted script into three batches, and both sqlcmd (without -b) and SSMS
// carry on past the two that fail. Banning line breaks kills that whole class
// instead of pattern-matching GO, and an inline column constraint has no
// legitimate need to span lines.
const STATEMENT_BREAK_RE = /;|--|#|\/\*|[\r\n]/;
const MAX_REPORTED_LENGTH = 100;

// The expression is emitted as CHECK(<expr>), so escaping that parenthesis
// group is the real attack primitive: "1=1), evil INT, CHECK(1=1" needs no
// blocked token at all. Requiring balanced parentheses removes it.
//
// LIMITATION: this counts parentheses in the raw string, so a parenthesis
// inside a quoted SQL literal (CHECK(name <> ')')) is counted too and such an
// expression is rejected. That is deliberate — tracking quote state would let
// an attacker use an unbalanced quote to hide a ')' from the scanner, trading
// a false rejection for a real bypass.
function hasUnbalancedParens(s) {
  let depth = 0;
  for (const ch of s) {
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth < 0) return true;
    }
  }
  return depth !== 0;
}

// The expression is attacker-controlled (it can arrive in an imported .ddb),
// so bound how much of it is echoed back into the UI.
function reject(rule, s) {
  const shown =
    s.length > MAX_REPORTED_LENGTH ? `${s.slice(0, MAX_REPORTED_LENGTH)}…` : s;
  throw new Error(`${rule} Refusing to generate SQL for: ${shown}`);
}

export function assertNoStatementBreak(expr) {
  const s = expr == null ? "" : String(expr);
  if (STATEMENT_BREAK_RE.test(s) || hasUnbalancedParens(s)) {
    reject(
      "CHECK expression must be a single line with balanced parentheses " +
        "(including inside quoted literals) and may not contain " +
        "';', '--', '#' or '/*'.",
      s,
    );
  }
  return s;
}

// A DEFAULT reaches the script unquoted on three paths in parseDefault: a
// function-shaped value, a keyword, and any value on a type without quotes
// (numerics). All three are raw interpolation, so each needs a shape.
//
// Arguments of a function default: literals, identifiers and separators only.
// Excludes ';', '#', '/', parentheses and line breaks, so nothing inside the
// call can terminate the statement or open a comment. Permits '-' for dates
// like to_date('2020-01-01', ...); '--' is rejected separately.
const FUNCTION_ARGS_RE = /^[A-Za-z0-9_,.'" \t-]*$/;

// A bare default must look like a literal: no commas (which would end the
// column definition and start another), no spaces, no parentheses.
const BARE_DEFAULT_RE = /^[A-Za-z0-9_.+-]*$/;

export function assertSafeDefault(value) {
  const s = value == null ? "" : String(value);

  if (isFunction(s)) {
    const args = s.slice(s.indexOf("(") + 1, s.lastIndexOf(")"));
    if (!FUNCTION_ARGS_RE.test(args) || args.includes("--")) {
      reject(
        "A function DEFAULT may only take literal or identifier arguments.",
        s,
      );
    }
    return s;
  }

  if (!BARE_DEFAULT_RE.test(s) || s.includes("--")) {
    reject(
      "An unquoted DEFAULT must be a bare literal, keyword or function call.",
      s,
    );
  }
  return s;
}
