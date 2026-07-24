import { DB } from "../../data/constants.js";

const MARIADB_COLUMN_TYPES =
  /^(\s*)status(\s+)(?=(?:bigint|binary|bit|boolean|char|date|datetime|decimal|double|enum|float|geometry|int|integer|json|longtext|mediumint|numeric|set|smallint|text|time|timestamp|tinyint|uuid|varbinary|varchar|vector|year)\b)/gim;

export function normalizeSQLForParser(sql, database) {
  if (database !== DB.MARIADB) return sql;

  return (
    sql
      // node-sql-parser's mysql grammar (which we use for MariaDB, see
      // parserDatabase) doesn't understand `CREATE OR REPLACE TABLE`; dropping
      // `OR REPLACE` leaves a plain CREATE TABLE with identical structure for
      // import purposes. This is exactly what our MariaDB exporter emits.
      .replace(/\bCREATE\s+OR\s+REPLACE\s+TABLE\b/gi, "CREATE TABLE")
      // node-sql-parser treats STATUS as a MariaDB keyword even when it appears
      // in a valid column-definition position. Quoting only that identifier
      // position preserves meaning without touching comments or string values.
      .replace(MARIADB_COLUMN_TYPES, "$1`status`$2")
  );
}

// The grammar node-sql-parser should use for a given dialect. MariaDB's grammar
// can't parse `CREATE OR REPLACE TABLE` or FK-adding ALTERs, but the mysql
// grammar parses both (MariaDB DDL, as our exporter emits it, is a MySQL
// superset), so MariaDB is parsed with the mysql grammar.
export function parserDatabase(database) {
  return database === DB.MARIADB ? DB.MYSQL : database;
}
