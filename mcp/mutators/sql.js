// SQL export, reusing the client's exporters via the generated Node bundle
// (mcp/vendor/exportSQL.js; see vite.mcp.config.js). exportSQL reads the same
// wire-document fields the MCP service uses (tables, references, types, enums,
// database), so the document is passed straight through.
import { exportSQL } from "../vendor/exportSQL.js";

export function exportSql(doc) {
  // GENERIC has no SQL dialect (exportSQL returns ""); surface that clearly
  // instead of handing back an empty string.
  if (doc.database === "generic")
    throw new Error(
      'The "generic" database has no SQL dialect. Use set_database to pick a concrete engine (e.g. postgresql, mysql) before exporting SQL.',
    );
  // The exporters map over enums/types unconditionally (the client always
  // passes them as arrays); our wire document omits them when empty.
  const sql = exportSQL({ ...doc, enums: doc.enums ?? [], types: doc.types ?? [] });
  if (!sql || !sql.trim())
    throw new Error(`No SQL was generated for database "${doc.database}".`);
  return sql;
}
