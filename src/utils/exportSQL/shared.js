import { isFunction, isKeyword, getRelationshipFields } from "../utils";

import { safeConstraint, assertSafeDefault, escapeQuotes } from "./sqlSafety";
import { DB } from "../../data/constants";
import { dbToTypes } from "../../data/datatypes";

export function getFkColumnNames(relationship, startTable, endTable) {
  const pairs = getRelationshipFields(relationship);
  const startColumns = pairs.map(
    (p) => startTable?.fields.find((f) => f.id === p.startFieldId)?.name,
  );
  const endColumns = pairs.map(
    (p) => endTable?.fields.find((f) => f.id === p.endFieldId)?.name,
  );
  return { startColumns, endColumns };
}

export function parseDefault(field, database = DB.GENERIC) {
  // These three branches interpolate the value into the script unquoted, so
  // the value has to carry its own shape guarantee -- anchoring isFunction
  // only constrained the outside of the call, not what sits between the
  // parentheses.
  if (
    isFunction(field.default) ||
    isKeyword(field.default) ||
    !dbToTypes[database][field.type].hasQuotes
  ) {
    return assertSafeDefault(field.default);
  }

  return `'${escapeQuotes(field.default, database)}'`;
}

export function exportFieldComment(comment) {
  if (comment === "") {
    return "";
  }

  return String(comment)
    .split(/\r\n|[\r\n]/)
    .map((commentLine) => `\t-- ${commentLine}\n`)
    .join("");
}

export function uniqueConstraintClause(table, quote) {
  const constraints = (table.uniqueConstraints || []).filter(
    (uc) => Array.isArray(uc.fields) && uc.fields.length > 0,
  );
  if (constraints.length === 0) return "";

  return (
    ",\n" +
    constraints
      .map(
        (uc) =>
          `\tCONSTRAINT ${quote(uc.name)} UNIQUE (${uc.fields
            .map((f) => quote(f))
            .join(", ")})`,
      )
      .join(",\n")
  );
}

// `q` is required: defaulting to ANSI double quotes would let a future caller
// silently emit Postgres-style quoting into a MySQL or MSSQL script.
export function getInlineFK(table, obj, q) {
  let fks = [];
  obj.references.forEach((r) => {
    if (r.startTableId === table.id) {
      const endTable = obj.tables.find((t) => t.id === r.endTableId);
      const { startColumns, endColumns } = getFkColumnNames(r, table, endTable);
      fks.push(
        `\tFOREIGN KEY (${startColumns
          .map((c) => q(c))
          .join(", ")}) REFERENCES ${q(endTable?.name)}(${endColumns
          .map((c) => q(c))
          .join(
            ", ",
          )})\n\tON UPDATE ${safeConstraint(r.updateConstraint)} ON DELETE ${safeConstraint(r.deleteConstraint)}`,
      );
    }
  });
  return fks.join(",\n");
}
