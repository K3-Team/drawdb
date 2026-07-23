import {
  exportFieldComment,
  getInlineFK,
  parseDefault,
  uniqueConstraintClause,
} from "./shared";
import {
  quoterFor,
  assertNoStatementBreak,
  assertSafeType,
} from "./identifiers";

import { dbToTypes } from "../../data/datatypes";
import { DB } from "../../data/constants";

export function toSqlite(diagram) {
  const q = quoterFor(DB.SQLITE);

  return diagram.tables
    .map((table) => {
      const inlineFK = getInlineFK(table, diagram, q);
      return `${
        table.comment === "" ? "" : `/* ${table.comment} */\n`
      }CREATE TABLE IF NOT EXISTS ${q(table.name)} (\n${table.fields
        .map(
          (field) =>
            `${exportFieldComment(field.comment)}\t${q(
              field.name,
            )} ${assertSafeType(field.type)}${field.notNull ? " NOT NULL" : ""}${
              field.unique ? " UNIQUE" : ""
            }${field.default !== "" ? ` DEFAULT ${parseDefault(field, diagram.database)}` : ""}${
              field.check === "" ||
              !dbToTypes[diagram.database][field.type].hasCheck
                ? ""
                : ` CHECK(${assertNoStatementBreak(field.check)})`
            }`,
        )
        .join(",\n")}${
        table.fields.filter((f) => f.primary).length > 0
          ? `,\n\tPRIMARY KEY(${table.fields
              .filter((f) => f.primary)
              .map((f) => q(f.name))
              .join(", ")})${inlineFK !== "" ? ",\n" : ""}`
          : ""
      }${inlineFK}${uniqueConstraintClause(table, q)}\n);\n${table.indices
        .map(
          (i) =>
            `\nCREATE ${i.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${q(
              i.name,
            )}\nON ${q(table.name)} (${i.fields.map((f) => q(f)).join(", ")});`,
        )
        .join("\n")}`;
    })
    .join("\n");
}
