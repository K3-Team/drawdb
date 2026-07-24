// Escaping for the non-SQL export targets (DBML, Mermaid, Markdown).
//
// A shared or imported diagram is attacker-controlled. Every diagram value
// interpolated into these outputs must be neutralised so it cannot break out
// of its syntactic context: DBML compiles straight to SQL, and Mermaid /
// Markdown are rendered in the viewer's tools where a break-out is an
// injection or XSS vector. The SQL exporters already harden their own output
// via exportSQL/sqlSafety.js; these are the equivalents for the other grammars.

// ---- DBML ----------------------------------------------------------------

// A single-quoted DBML string: escape backslash and quote, flatten newlines.
export function dbmlString(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/[\r\n]+/g, " ");
}

// A bare value inside a [ ... ] settings block must be a plain token; anything
// with other characters is quoted as a string so it cannot close the block or
// inject a new setting.
const DBML_BARE_RE = /^[A-Za-z0-9_ ]+$/;
export function dbmlSetting(value) {
  const v = String(value ?? "").trim();
  return DBML_BARE_RE.test(v) ? v : `'${dbmlString(v)}'`;
}

// headercolor takes a hex colour; drop anything else (returns null → omit).
export function dbmlColor(value) {
  const v = String(value ?? "").trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : null;
}

// A DBML type token compiles into SQL, so strip to a safe charset.
export function dbmlType(value) {
  return (
    String(value ?? "")
      .replace(/[^A-Za-z0-9_ ]/g, "")
      .toLowerCase() || "varchar"
  );
}

// A size like "255" or "10, 2": digits, commas, spaces only (null → omit).
export function dbmlSize(value) {
  const v = String(value ?? "").trim();
  return /^[0-9, ]+$/.test(v) ? v : null;
}

// A DBML expression in backticks (function defaults): strip backticks so the
// expression cannot close its own delimiter.
export function dbmlBacktick(value) {
  return `\`${String(value ?? "").replace(/`/g, "")}\``;
}

// ---- Mermaid (display only) ----------------------------------------------

// Reduce any identifier to a Mermaid-safe token. Mermaid ER identifiers are
// alphanumeric/underscore; sanitising is acceptable because the output is
// display-only, and it removes the newline / brace / quote break-out chars.
export function mermaidToken(value) {
  return String(value ?? "").replace(/[^A-Za-z0-9_]/g, "_") || "unnamed";
}

// ---- Markdown inline ------------------------------------------------------

// Neutralise table-cell, heading, and bold break-outs: table pipes, newlines,
// raw HTML (XSS), and code backticks.
export function mdInline(value) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\|/g, "\\|")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/`/g, "\\`");
}

// A Markdown anchor slug for table-of-contents links.
export function mdAnchor(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-");
}
