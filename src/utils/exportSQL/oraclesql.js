import { dbToTypes } from "../../data/datatypes";
import { DB } from "../../data/constants";
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
  sqlBlockComment,
  sqlLineComment,
} from "./sqlSafety";

export function toOracleSQL(diagram) {
  const q = quoterFor(DB.ORACLESQL);

  return `${diagram.tables
    .map(
      (table) =>
        `${
          table.comment === ""
            ? ""
            : `/* ${sqlBlockComment(table.comment)} */\n`
        }CREATE TABLE ${q(table.name)} (\n${table.fields
          .map(
            (field) =>
              `${field.comment === "" ? "" : `\t-- ${sqlLineComment(field.comment)}\n`}\t${q(
                field.name,
              )} ${assertSafeType(field.type)}${
                field.size !== undefined && field.size !== ""
                  ? "(" + assertSafeSize(field.size) + ")"
                  : ""
              }${field.notNull ? " NOT NULL" : ""}${
                field.increment ? " GENERATED ALWAYS AS IDENTITY" : ""
              }${field.unique ? " UNIQUE" : ""}${
                field.default !== ""
                  ? ` DEFAULT ${parseDefault(field, diagram.database)}`
                  : ""
              }${
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
                .join(", ")})`
            : ""
        }${uniqueConstraintClause(table, q)}\n);\n${`\n${table.indices
          .map(
            (i) =>
              `\nCREATE ${i.unique ? "UNIQUE " : ""}INDEX ${q(i.name)}\nON ${q(table.name)} (${i.fields
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
      return `ALTER TABLE ${q(startName)}\nADD CONSTRAINT ${q(r.name)} FOREIGN KEY (${startColumns
        .map((c) => q(c))
        .join(", ")}) REFERENCES ${q(endName)} (${endColumns
        .map((c) => q(c))
        .join(
          ", ",
        )})\nON UPDATE ${safeConstraint(r.updateConstraint)} ON DELETE ${safeConstraint(r.deleteConstraint)};`;
    })
    .join("\n")}`;
}
