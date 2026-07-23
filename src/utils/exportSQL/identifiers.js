import { DB, Constraint } from "../../data/constants";

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

const STATEMENT_BREAK_RE = /;|--|\/\*/;
const MAX_REPORTED_LENGTH = 100;

export function assertNoStatementBreak(expr) {
  const s = expr == null ? "" : String(expr);
  if (STATEMENT_BREAK_RE.test(s)) {
    // The expression is attacker-controlled (it can arrive in an imported
    // .ddb), so bound how much of it is echoed back into the UI.
    const shown =
      s.length > MAX_REPORTED_LENGTH
        ? `${s.slice(0, MAX_REPORTED_LENGTH)}…`
        : s;
    throw new Error(
      `CHECK expression may not contain ';', '--' or '/*'. Refusing to generate SQL for: ${shown}`,
    );
  }
  return s;
}
