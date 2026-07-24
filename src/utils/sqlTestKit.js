// Shared helpers for the per-dialect SQL import/export test suites.
//
// Two things live here so the per-DB test files stay thin:
//   1. parseAndImport / roundTrip — exercise the exact flow the app uses
//      (normalizeSQLForParser -> node-sql-parser -> importSQL), plus the
//      export side (exportSQL), so a fixture can be pushed through
//      diagram -> SQL -> parse -> diagram and compared.
//   2. runLiveDDL — feed generated DDL to a throwaway instance of the real
//      engine (via scripts/livedb/*.sh + nix-shell) to confirm the current
//      release actually accepts it. Gated behind DRAWDB_LIVE_DB=1 so ordinary
//      `vitest` runs need no database.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Parser } from "node-sql-parser";
import { exportSQL } from "./exportSQL";
import { importSQL } from "./importSQL";
import { normalizeSQLForParser, parserDatabase } from "./importSQL/normalize";

// Parse SQL exactly like Modal.jsx does, then import it into a diagram.
export function parseAndImport(sql, db) {
  const ast = new Parser().astify(normalizeSQLForParser(sql, db), {
    database: parserDatabase(db),
  });
  return importSQL(ast, db, db);
}

// diagram -> SQL (exportSQL) -> parse -> diagram. Returns both so a test can
// assert the SQL text AND that the model survives the round trip.
export function roundTrip(diagram) {
  const sql = exportSQL(diagram);
  const imported = parseAndImport(sql, diagram.database);
  return { sql, imported };
}

// ---- Live-engine validation (opt-in) -------------------------------------

export const LIVE_DB = process.env.DRAWDB_LIVE_DB === "1";

// nix package + harness script per engine. mysql84 is the current MySQL attr
// (mysql80 was dropped from nixpkgs); mariadb and mysql share one script.
const ENGINES = {
  sqlite: { pkg: "sqlite", script: "sqlite.sh" },
  postgres: { pkg: "postgresql", script: "pg.sh" },
  mariadb: { pkg: "mariadb", script: "mysql.sh" },
  mysql: { pkg: "mysql84", script: "mysql.sh" },
};

// Run `sql` against a throwaway instance of `engine`. Returns { ok } or
// { ok:false, error }. Never spins anything up unless LIVE_DB is set — the
// caller is expected to gate the whole describe() block on LIVE_DB.
export function runLiveDDL(engine, sql) {
  const cfg = ENGINES[engine];
  if (!cfg) throw new Error(`unknown live engine: ${engine}`);
  const dir = mkdtempSync(join(tmpdir(), "drawdb-live-"));
  const file = join(dir, "ddl.sql");
  writeFileSync(file, sql);
  try {
    execFileSync(
      "nix-shell",
      ["-p", cfg.pkg, "--run", `bash scripts/livedb/${cfg.script} ${file}`],
      { stdio: "pipe", timeout: 180000 },
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e.stderr?.toString() || e.message || "").trim() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
// Gate a live block with:  (LIVE_DB ? describe : describe.skip)("live ...", ...)
