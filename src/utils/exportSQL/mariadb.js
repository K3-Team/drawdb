import {
  parseDefault,
  uniqueConstraintClause,
  getFkColumnNames,
} from "./shared";
import {
  quoterFor,
  safeConstraint,
  assertNoStatementBreak,
  assertSafeSize,
  assertSafeType,
  escapeQuotes,
} from "./sqlSafety";

import { dbToTypes } from "../../data/datatypes";
import { DB } from "../../data/constants";

function parseType(field) {
  let res = assertSafeType(field.type);

  if (field.type === "SET" || field.type === "ENUM") {
    res += `${field.values ? "(" + field.values.map((value) => "'" + escapeQuotes(value) + "'").join(", ") + ")" : ""}`;
  }

  if (
    dbToTypes[DB.MARIADB][field.type].isSized ||
    dbToTypes[DB.MARIADB][field.type].hasPrecision
  ) {
    res += `${field.size && field.size !== "" ? "(" + assertSafeSize(field.size) + ")" : ""}`;
  }

  return res;
}

export function toMariaDB(diagram) {
  const q = quoterFor(DB.MARIADB);

  return `${diagram.tables
    .map(
      (table) =>
        `CREATE OR REPLACE TABLE ${q(table.name)} (\n${table.fields
          .map(
            (field) =>
              `\t${q(field.name)} ${parseType(field)}${field.unsigned ? " UNSIGNED" : ""}${field.notNull ? " NOT NULL" : ""}${
                field.increment ? " AUTO_INCREMENT" : ""
              }${field.unique ? " UNIQUE" : ""}${
                field.default !== ""
                  ? ` DEFAULT ${parseDefault(field, diagram.database)}`
                  : ""
              }${
                field.check === "" ||
                !dbToTypes[diagram.database][field.type].hasCheck
                  ? ""
                  : ` CHECK(${assertNoStatementBreak(field.check)})`
              }${field.comment ? ` COMMENT '${escapeQuotes(field.comment)}'` : ""}`,
          )
          .join(",\n")}${
          table.fields.filter((f) => f.primary).length > 0
            ? `,\n\tPRIMARY KEY(${table.fields
                .filter((f) => f.primary)
                .map((f) => q(f.name))
                .join(", ")})`
            : ""
        }${uniqueConstraintClause(table, q)}\n)${table.comment ? ` COMMENT='${escapeQuotes(table.comment)}'` : ""};${`\n${table.indices
          .map(
            (i) =>
              `\nCREATE ${i.unique ? "UNIQUE " : ""}INDEX ${q(
                i.name,
              )}\nON ${q(table.name)} (${i.fields
                .map((f) => q(f))
                .join(", ")});`,
          )
          .join("")}`}`,
    )
    .join("\n")}\n${diagram.references
    .map((r) => {
      const { name: startName, fields: startFields } = diagram.tables.find(
        (t) => t.id === r.startTableId,
      );

      const endTable = diagram.tables.find((t) => t.id === r.endTableId);
      const { name: endName } = endTable;
      const { startColumns, endColumns } = getFkColumnNames(
        r,
        { fields: startFields },
        endTable,
      );
      return `ALTER TABLE ${q(startName)}\nADD FOREIGN KEY(${startColumns
        .map((c) => q(c))
        .join(", ")}) REFERENCES ${q(endName)}(${endColumns
        .map((c) => q(c))
        .join(
          ", ",
        )})\nON UPDATE ${safeConstraint(r.updateConstraint)} ON DELETE ${safeConstraint(r.deleteConstraint)};`;
    })
    .join("\n")}`;
}
