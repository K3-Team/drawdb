import { DB } from "../../data/constants";
import { dbToTypes, defaultTypes } from "../../data/datatypes";
import {
  escapeQuotes,
  getInlineFK,
  parseDefault,
  uniqueConstraintClause,
  getFkColumnNames,
} from "./shared";
import {
  quoteIdentifier,
  quoterFor,
  safeConstraint,
  assertNoStatementBreak,
  assertSafeSize,
  assertSafeType,
  sqlBlockComment,
  sqlLineComment,
} from "./identifiers";

export function getJsonType(f) {
  if (!Object.keys(defaultTypes).includes(f.type)) {
    return '{ "type" : "object", additionalProperties : true }';
  }
  switch (f.type) {
    case "INT":
    case "SMALLINT":
    case "BIGINT":
    case "DECIMAL":
    case "NUMERIC":
    case "REAL":
    case "FLOAT":
      return '{ "type" : "number" }';
    case "BOOLEAN":
      return '{ "type" : "boolean" }';
    case "JSON":
      return '{ "type" : "object", "additionalProperties" : true }';
    case "ENUM":
      return `{\n\t\t\t\t\t"type" : "string",\n\t\t\t\t\t"enum" : [${f.values
        .map((v) => JSON.stringify(String(v)))
        .join(", ")}]\n\t\t\t\t}`;
    case "SET":
      return `{\n\t\t\t\t\t"type": "array",\n\t\t\t\t\t"items": {\n\t\t\t\t\t\t"type": "string",\n\t\t\t\t\t\t"enum": [${f.values
        .map((v) => JSON.stringify(String(v)))
        .join(", ")}]\n\t\t\t\t\t}\n\t\t\t\t}`;
    default:
      return '{ "type" : "string"}';
  }
}

export function generateSchema(type) {
  return `{\n\t\t\t"$schema": "http://json-schema.org/draft-04/schema#",\n\t\t\t"type": "object",\n\t\t\t"properties": {\n\t\t\t\t${type.fields
    .map((f) => `${JSON.stringify(String(f.name))} : ${getJsonType(f)}`)
    .join(
      ",\n\t\t\t\t",
    )}\n\t\t\t},\n\t\t\t"additionalProperties": false\n\t\t}`;
}

export function getTypeString(
  field,
  currentDb,
  dbms = DB.MYSQL,
  baseType = false,
) {
  if (dbms === DB.MYSQL) {
    if (field.type === "UUID") {
      return `VARCHAR(36)`;
    }
    if (
      dbToTypes[currentDb][field.type].isSized ||
      dbToTypes[currentDb][field.type].hasPrecision
    ) {
      return `${assertSafeType(field.type)}${field.size ? `(${assertSafeSize(field.size)})` : ""}`;
    }
    if (field.type === "SET" || field.type === "ENUM") {
      return `${assertSafeType(field.type)}(${field.values
        .map((v) => `'${escapeQuotes(String(v))}'`)
        .join(", ")})`;
    }
    if (!Object.keys(defaultTypes).includes(field.type)) {
      return "JSON";
    }
    return assertSafeType(field.type);
  } else if (dbms === DB.POSTGRES) {
    if (field.type === "SMALLINT" && field.increment) {
      return "smallserial";
    }
    if (field.type === "INT" && field.increment) {
      return "serial";
    }
    if (field.type === "BIGINT" && field.increment) {
      return "bigserial";
    }
    if (field.type === "ENUM") {
      return quoteIdentifier(`${field.name}_t`, DB.POSTGRES);
    }
    if (field.type === "SET") {
      return `${quoteIdentifier(`${field.name}_t`, DB.POSTGRES)}[]`;
    }
    if (field.type === "TIMESTAMP") {
      return "TIMESTAMPTZ";
    }
    if (field.type === "DATETIME") {
      return `timestamp`;
    }
    if (dbToTypes[currentDb][field.type].isSized && field.size) {
      const type =
        field.type === "BINARY"
          ? "bit"
          : field.type === "VARBINARY"
            ? "bit varying"
            : field.type.toLowerCase();
      return `${assertSafeType(type)}(${assertSafeSize(field.size)})`;
    }
    if (
      dbToTypes[currentDb][field.type].hasPrecision &&
      field.size &&
      field.size.trim() !== ""
    ) {
      return `${assertSafeType(field.type.toLowerCase())}${field.size ? `(${assertSafeSize(field.size)})` : ""}`;
    }
    return field.type.toLowerCase();
  } else if (dbms === DB.MSSQL) {
    let type = assertSafeType(field.type);
    switch (field.type) {
      case "ENUM":
        return baseType
          ? "NVARCHAR(255)"
          : `NVARCHAR(255) CHECK(${quoteIdentifier(
              field.name,
              DB.MSSQL,
            )} in (${field.values
              .map((v) => `'${escapeQuotes(String(v))}'`)
              .join(", ")}))`;
      case "VARCHAR":
        type = `NVARCHAR`;
        break;
      case "UUID":
        type = "UNIQUEIDENTIFIER";
        break;
      case "DOUBLE":
        type = "FLOAT";
        break;
      case "BOOLEAN":
        return "BIT";
      case "SET":
        return "NVARCHAR(255)";
      case "BLOB":
        return "VARBINARY(MAX)";
      case "JSON":
        return "NVARCHAR(MAX)";
      case "TEXT":
        return "TEXT";
      default:
        type = field.type;
        break;
    }
    if (dbToTypes[currentDb][field.type].isSized) {
      return `${assertSafeType(type)}(${assertSafeSize(field.size)})`;
    }

    return type;
  } else if (dbms === DB.ORACLESQL) {
    let oracleType;
    switch (field.type) {
      case "BIGINT":
        oracleType = "NUMBER";
        break;
      case "VARCHAR":
        oracleType = "VARCHAR2";
        break;
      case "TEXT":
        oracleType = "CLOB";
        break;
      case "TIME":
      case "DATETIME":
        oracleType = "TIMESTAMP";
        break;
      case "BINARY":
      case "VARBINARY":
        oracleType = "RAW";
        break;
      case "UUID":
        oracleType = "RAW(16)";
        break;
      case "SET":
      case "ENUM":
        return quoteIdentifier(`${field.name}_t`, DB.ORACLESQL);
      default:
        oracleType = assertSafeType(field.type);
        break;
    }
    const typeInfo = dbToTypes[currentDb][oracleType];
    if (typeInfo.isSized || typeInfo.hasPrecision) {
      if (oracleType === "NUMBER") {
        return `${assertSafeType(oracleType)}${field.size ? `(${assertSafeSize(field.size)})` : "(38,0)"}`;
      } else {
        return `${assertSafeType(oracleType)}${field.size ? `(${assertSafeSize(field.size)})` : ""}`;
      }
    }

    return oracleType;
  }
}

export function jsonToMySQL(obj) {
  const q = quoterFor(DB.MYSQL);

  return `${obj.tables
    .map(
      (table) =>
        `CREATE TABLE IF NOT EXISTS ${q(table.name)} (\n${table.fields
          .map(
            (field) =>
              `\t${q(
                field.name,
              )} ${getTypeString(field, obj.database)}${field.notNull ? " NOT NULL" : ""}${
                field.increment ? " AUTO_INCREMENT" : ""
              }${field.unique ? " UNIQUE" : ""}${
                field.default !== ""
                  ? ` DEFAULT ${parseDefault(field, obj.database)}`
                  : ""
              }${
                field.check === "" ||
                !dbToTypes[obj.database][field.type].hasCheck
                  ? !Object.keys(defaultTypes).includes(field.type)
                    ? ` CHECK(\n\t\tJSON_SCHEMA_VALID('${escapeQuotes(
                        generateSchema(
                          obj.types.find(
                            (t) => t.name === field.type.toLowerCase(),
                          ),
                        ),
                      )}', ${q(field.name)}))`
                    : ""
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
        }${uniqueConstraintClause(table, q)}\n)${table.comment ? ` COMMENT='${escapeQuotes(table.comment)}'` : ""};\n${`\n${table.indices
          .map(
            (i) =>
              `CREATE ${i.unique ? "UNIQUE " : ""}INDEX ${q(i.name)}\nON ${q(table.name)} (${i.fields
                .map((f) => q(f))
                .join(", ")});`,
          )
          .join("\n")}`}`,
    )
    .join("\n")}\n${obj.references
    .map((r) => {
      const { name: startName, fields: startFields } = obj.tables.find(
        (t) => t.id === r.startTableId,
      );

      const endTable = obj.tables.find((t) => t.id === r.endTableId);
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

export function jsonToPostgreSQL(obj) {
  const q = quoterFor(DB.POSTGRES);

  return `${obj.types.map((type) => {
    const typeStatements = type.fields
      .filter((f) => f.type === "ENUM" || f.type === "SET")
      .map(
        (f) =>
          `CREATE TYPE ${q(`${f.name}_t`)} AS ENUM (${f.values
            .map((v) => `'${escapeQuotes(String(v))}'`)
            .join(", ")});`,
      )
      .join("\n");
    if (typeStatements.length > 0) {
      return (
        typeStatements.join("") +
        `${
          type.comment === ""
            ? ""
            : `/**\n${sqlBlockComment(type.comment)}\n*/\n`
        }CREATE TYPE ${q(type.name)} AS (\n${type.fields
          .map(
            (f) =>
              `\t${q(f.name)} ${getTypeString(f, obj.database, DB.POSTGRES)}`,
          )
          .join("\n")}\n);`
      );
    } else {
      return `CREATE TYPE ${q(type.name)} AS (\n${type.fields
        .map(
          (f) =>
            `\t${q(f.name)} ${getTypeString(f, obj.database, DB.POSTGRES)}`,
        )
        .join(",\n")}\n);\n${
        type.comment && type.comment.trim() != ""
          ? `\nCOMMENT ON TYPE ${q(type.name)} IS '${escapeQuotes(type.comment)}';\n`
          : ""
      }`;
    }
  })}\n${obj.tables
    .map(
      (table) =>
        `${
          table.fields.filter((f) => f.type === "ENUM" || f.type === "SET")
            .length > 0
            ? `${table.fields
                .filter((f) => f.type === "ENUM" || f.type === "SET")
                .map(
                  (f) =>
                    `CREATE TYPE ${q(`${f.name}_t`)} AS ENUM (${f.values
                      .map((v) => `'${escapeQuotes(String(v))}'`)
                      .join(", ")});\n`,
                )
                .join("\n")}\n`
            : ""
        }CREATE TABLE IF NOT EXISTS ${q(table.name)} (\n${table.fields
          .map(
            (field) =>
              `${field.comment === "" ? "" : `\t-- ${sqlLineComment(field.comment)}\n`}\t${q(
                field.name,
              )} ${getTypeString(field, obj.database, DB.POSTGRES)}${
                field.notNull ? " NOT NULL" : ""
              }${field.unique ? " UNIQUE" : ""}${
                field.default !== "" ? ` DEFAULT ${parseDefault(field)}` : ""
              }${
                field.check === "" ||
                !dbToTypes[obj.database][field.type].hasCheck
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
        }${uniqueConstraintClause(table, q)}\n);\n${table.comment != "" ? `\nCOMMENT ON TABLE ${q(table.name)} IS '${escapeQuotes(table.comment)}';\n` : ""}${table.fields
          .map((field) =>
            field.comment.trim() !== ""
              ? `COMMENT ON COLUMN ${q(table.name)}.${q(field.name)} IS '${escapeQuotes(field.comment)}';\n`
              : "",
          )
          .join("")}\n${table.indices
          .map(
            (i) =>
              `CREATE ${i.unique ? "UNIQUE " : ""}INDEX ${q(
                i.name,
              )}\nON ${q(table.name)} (${i.fields
                .map((f) => q(f))
                .join(", ")});`,
          )
          .join("\n")}`,
    )
    .join("\n")}\n${obj.references
    .map((r) => {
      const { name: startName, fields: startFields } = obj.tables.find(
        (t) => t.id === r.startTableId,
      );

      const endTable = obj.tables.find((t) => t.id === r.endTableId);
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

export function getSQLiteType(field) {
  switch (field.type) {
    case "INT":
    case "SMALLINT":
    case "BIGINT":
    case "BOOLEAN":
      return "INTEGER";
    case "DECIMAL":
    case "NUMERIC":
    case "FLOAT":
    case "DOUBLE":
    case "REAL":
      return "REAL";
    case "CHAR":
    case "VARCHAR":
    case "UUID":
    case "TEXT":
    case "DATE":
    case "TIME":
    case "TIMESTAMP":
    case "DATETIME":
    case "BINARY":
    case "VARBINARY":
      return "TEXT";
    case "ENUM":
      return `TEXT CHECK(${quoteIdentifier(
        field.name,
        DB.SQLITE,
      )} in (${field.values
        .map((v) => `'${escapeQuotes(String(v))}'`)
        .join(", ")}))`;
    default:
      return "BLOB";
  }
}

export function jsonToSQLite(obj) {
  const q = quoterFor(DB.SQLITE);

  return obj.tables
    .map((table) => {
      const inlineFK = getInlineFK(table, obj, q);
      return `${
        table.comment === "" ? "" : `/* ${sqlBlockComment(table.comment)} */\n`
      }CREATE TABLE IF NOT EXISTS ${q(table.name)} (\n${table.fields
        .map(
          (field) =>
            `${field.comment === "" ? "" : `\t-- ${sqlLineComment(field.comment)}\n`}\t${q(
              field.name,
            )} ${getSQLiteType(field)}${field.notNull ? " NOT NULL" : ""}${
              field.unique ? " UNIQUE" : ""
            }${field.default !== "" ? ` DEFAULT ${parseDefault(field, obj.database)}` : ""}${
              field.check === "" ||
              !dbToTypes[obj.database][field.type].hasCheck
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

export function jsonToMariaDB(obj) {
  const q = quoterFor(DB.MARIADB);

  return `${obj.tables
    .map(
      (table) =>
        `CREATE OR REPLACE TABLE ${q(table.name)} (\n${table.fields
          .map(
            (field) =>
              `\t${q(
                field.name,
              )} ${getTypeString(field, obj.database, DB.MYSQL)}${field.notNull ? " NOT NULL" : ""}${
                field.increment ? " AUTO_INCREMENT" : ""
              }${field.unique ? " UNIQUE" : ""}${
                field.default !== ""
                  ? ` DEFAULT ${parseDefault(field, obj.database)}`
                  : ""
              }${
                field.check === "" ||
                !dbToTypes[obj.database][field.type].hasCheck
                  ? !Object.keys(defaultTypes).includes(field.type)
                    ? ` CHECK(\n\t\tJSON_SCHEMA_VALID('${escapeQuotes(
                        generateSchema(
                          obj.types.find(
                            (t) => t.name === field.type.toLowerCase(),
                          ),
                        ),
                      )}', ${q(field.name)}))`
                    : ""
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
              `CREATE ${i.unique ? "UNIQUE " : ""}INDEX ${q(
                i.name,
              )}\nON ${q(table.name)} (${i.fields
                .map((f) => q(f))
                .join(", ")});`,
          )
          .join("\n")}`}`,
    )
    .join("\n")}\n${obj.references
    .map((r) => {
      const { name: startName, fields: startFields } = obj.tables.find(
        (t) => t.id === r.startTableId,
      );

      const endTable = obj.tables.find((t) => t.id === r.endTableId);
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

export function jsonToSQLServer(obj) {
  const q = quoterFor(DB.MSSQL);

  return `${obj.types
    .map((type) => {
      return `${
        type.comment === "" ? "" : `/**\n${sqlBlockComment(type.comment)}\n*/\n`
      }CREATE TYPE ${q(type.name)} FROM ${
        type.fields.length < 0
          ? ""
          : `${getTypeString(type.fields[0], obj.database, DB.MSSQL, true)}`
      };\nGO\n`;
    })
    .join("\n")}\n${obj.tables
    .map(
      (table) =>
        `${
          table.comment === ""
            ? ""
            : `/**\n${sqlBlockComment(table.comment)}\n*/\n`
        }CREATE TABLE ${q(table.name)} (\n${table.fields
          .map(
            (field) =>
              `${field.comment === "" ? "" : `\t-- ${sqlLineComment(field.comment)}\n`}\t${q(
                field.name,
              )} ${getTypeString(field, obj.database, DB.MSSQL)}${
                field.notNull ? " NOT NULL" : ""
              }${field.increment ? " IDENTITY" : ""}${
                field.unique ? " UNIQUE" : ""
              }${
                field.default !== ""
                  ? ` DEFAULT ${parseDefault(field, obj.database)}`
                  : ""
              }${
                field.check === "" ||
                !dbToTypes[obj.database][field.type].hasCheck
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
        }${uniqueConstraintClause(table, q)}\n);\nGO\n${table.indices
          .map(
            (i) =>
              `\nCREATE ${i.unique ? "UNIQUE " : ""}INDEX ${q(
                i.name,
              )}\nON ${q(table.name)} (${i.fields
                .map((f) => q(f))
                .join(", ")});\nGO\n`,
          )
          .join("")}`,
    )
    .join("\n")}\n${obj.references
    .map((r) => {
      const { name: startName, fields: startFields } = obj.tables.find(
        (t) => t.id === r.startTableId,
      );

      const endTable = obj.tables.find((t) => t.id === r.endTableId);
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
        )})\nON UPDATE ${safeConstraint(r.updateConstraint)} ON DELETE ${safeConstraint(r.deleteConstraint)};\nGO`;
    })
    .join("\n")}`;
}

export function jsonToOracleSQL(obj) {
  const q = quoterFor(DB.ORACLESQL);

  return `${obj.tables
    .map(
      (table) =>
        `${
          table.fields.filter((f) => f.type === "ENUM" || f.type === "SET")
            .length > 0
            ? `${table.fields
                .filter((f) => f.type === "ENUM" || f.type === "SET")
                .map(
                  (f) =>
                    `CREATE DOMAIN ${q(`${f.name}_t`)} AS ENUM (${f.values
                      .map((v) => `'${escapeQuotes(String(v))}'`)
                      .join(", ")});\n`,
                )
                .join("\n")}\n`
            : ""
        }${
          table.comment === ""
            ? ""
            : `/* ${sqlBlockComment(table.comment)} */\n`
        }CREATE TABLE ${q(table.name)} (\n${table.fields
          .map(
            (field) =>
              `${field.comment === "" ? "" : `  -- ${sqlLineComment(field.comment)}\n`}  ${q(
                field.name,
              )} ${getTypeString(field, obj.database, DB.ORACLESQL)}${
                field.notNull ? " NOT NULL" : ""
              }${field.increment ? " GENERATED ALWAYS AS IDENTITY" : ""}${
                field.unique ? " UNIQUE" : ""
              }${
                field.default !== ""
                  ? ` DEFAULT ${parseDefault(field, obj.database)}`
                  : ""
              }${
                field.check === "" ||
                !dbToTypes[obj.database][field.type].hasCheck
                  ? ""
                  : ` CHECK (${assertNoStatementBreak(field.check)})`
              }`,
          )
          .join(",\n")}${
          table.fields.filter((f) => f.primary).length > 0
            ? `,\n  PRIMARY KEY (${table.fields
                .filter((f) => f.primary)
                .map((f) => q(f.name))
                .join(", ")})`
            : ""
        }${uniqueConstraintClause(table, q)}\n);\n${table.indices
          .map(
            (i) =>
              `\nCREATE ${i.unique ? "UNIQUE " : ""}INDEX ${q(i.name)}\n  ON ${q(
                table.name,
              )} (${i.fields.map((f) => q(f)).join(", ")});`,
          )
          .join("\n")}`,
    )
    .join("\n\n")}\n${obj.references
    .map((r) => {
      const { name: startName, fields: startFields } = obj.tables.find(
        (t) => t.id === r.startTableId,
      );

      const endTable = obj.tables.find((t) => t.id === r.endTableId);
      const { name: endName } = endTable;
      const { startColumns, endColumns } = getFkColumnNames(
        r,
        { fields: startFields },
        endTable,
      );
      return `ALTER TABLE ${q(startName)}\nADD CONSTRAINT ${q(r.name)} FOREIGN KEY (${startColumns
        .map((c) => q(c))
        .join(", ")}) REFERENCES ${q(endName)}(${endColumns
        .map((c) => q(c))
        .join(", ")});`;
    })
    .join("\n")}`;
}
