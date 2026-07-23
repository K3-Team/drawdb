import {
  parseDefault,
  escapeQuotes,
  uniqueConstraintClause,
  getFkColumnNames,
} from "./shared";
import {
  quoterFor,
  safeConstraint,
  assertNoStatementBreak,
  assertSafeSize,
  assertSafeType,
} from "./identifiers";

import { dbToTypes } from "../../data/datatypes";
import { DB } from "../../data/constants";

function generateAddExtendedPropertySQL(value, level1name, level2name = null) {
  if (!value || value.trim() === "") {
    return "";
  }
  const escapedValue = escapeQuotes(value.replace(/\n/g, " "));
  const escapedTableName = escapeQuotes(level1name);

  if (level2name) {
    const escapedColumnName = escapeQuotes(level2name);
    return `
EXEC sys.sp_addextendedproperty
    @name=N'MS_Description', @value=N'${escapedValue}',
    @level0type=N'SCHEMA',@level0name=N'dbo',
    @level1type=N'TABLE',@level1name=N'${escapedTableName}',
    @level2type=N'COLUMN',@level2name=N'${escapedColumnName}';
GO
`;
  } else {
    return `
EXEC sys.sp_addextendedproperty
    @name=N'MS_Description', @value=N'${escapedValue}',
    @level0type=N'SCHEMA',@level0name=N'dbo',
    @level1type=N'TABLE',@level1name=N'${escapedTableName}';
GO
`;
  }
}

export function toMSSQL(diagram) {
  const q = quoterFor(DB.MSSQL);

  const tablesSql = diagram.tables
    .map((table) => {
      const fieldsSql = table.fields
        .map((field) => {
          const typeMetaData = dbToTypes[DB.MSSQL][field.type.toUpperCase()];
          const isSized = typeMetaData.isSized || typeMetaData.hasPrecision;

          return `\t${q(field.name)} ${assertSafeType(field.type)}${field.size && isSized ? `(${assertSafeSize(field.size)})` : ""}${
            field.notNull ? " NOT NULL" : ""
          }${field.increment ? " IDENTITY" : ""}${
            field.unique ? " UNIQUE" : ""
          }${
            field.default !== ""
              ? ` DEFAULT ${parseDefault(field, diagram.database)}`
              : ""
          }${
            field.check === "" ||
            !dbToTypes[diagram.database][field.type].hasCheck
              ? ""
              : ` CHECK(${assertNoStatementBreak(field.check)})`
          }`;
        })
        .join(",\n");

      const primaryKeys = table.fields.filter((f) => f.primary);
      const primaryKeySql =
        primaryKeys.length > 0
          ? `,\n\tPRIMARY KEY(${primaryKeys.map((f) => q(f.name)).join(", ")})`
          : "";

      const uniqueSql = uniqueConstraintClause(table, q);

      const createTableSql = `CREATE TABLE ${q(table.name)} (\n${fieldsSql}${primaryKeySql}${uniqueSql}\n);\nGO\n`;

      const tableCommentSql = generateAddExtendedPropertySQL(
        table.comment,
        table.name,
      );

      const columnCommentsSql = table.fields
        .map((field) =>
          generateAddExtendedPropertySQL(field.comment, table.name, field.name),
        )
        .join("");

      const indicesSql = table.indices
        .map(
          (i) =>
            `\nCREATE ${i.unique ? "UNIQUE " : ""}INDEX ${q(
              i.name,
            )}\nON ${q(table.name)} (${i.fields
              .map((f) => q(f))
              .join(", ")});\nGO\n`,
        )
        .join("");

      return `${createTableSql}${tableCommentSql}${columnCommentsSql}${indicesSql}`;
    })
    .join("\n");

  const referencesSql = diagram.references
    .map((r) => {
      const startTable = diagram.tables.find((t) => t.id === r.startTableId);
      const endTable = diagram.tables.find((t) => t.id === r.endTableId);

      if (!startTable || !endTable) return "";

      const { startColumns, endColumns } = getFkColumnNames(
        r,
        startTable,
        endTable,
      );

      if (startColumns.some((c) => !c) || endColumns.some((c) => !c)) return "";

      return `\nALTER TABLE ${q(startTable.name)}
ADD FOREIGN KEY(${startColumns.map((c) => q(c)).join(", ")})
REFERENCES ${q(endTable.name)}(${endColumns.map((c) => q(c)).join(", ")})
ON UPDATE ${safeConstraint(r.updateConstraint)} ON DELETE ${safeConstraint(r.deleteConstraint)};
GO`;
    })
    .join("");

  return `${tablesSql}\n${referencesSql}`;
}
