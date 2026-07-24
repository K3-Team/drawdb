import { dbToTypes } from "../../data/datatypes";
import { jsonToMermaid } from "./mermaid";
import { databases } from "../../data/databases";
import { getRelationshipFields } from "../utils";
import { mdInline, mdAnchor } from "./escape";

// Prose comment blocks are not inside a table, so keep newlines, but still
// neutralise raw HTML so an imported/shared diagram cannot inject a script.
function mdBlock(value) {
  return String(value ?? "")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatMarkdownTable(headers, rows) {
  const allRows = [headers, ...rows];
  const colWidths = headers.map((_, colIndex) =>
    Math.max(...allRows.map((row) => (row[colIndex] ?? "").length)),
  );

  const pad = (cell, width) => (cell ?? "").padEnd(width);
  const separator = colWidths.map((w) => "-".repeat(w)).join(" | ");
  const headerRow = headers.map((h, i) => pad(h, colWidths[i])).join(" | ");
  const dataRows = rows
    .map(
      (row) => `| ${row.map((cell, i) => pad(cell, colWidths[i])).join(" | ")} |`,
    )
    .join("\n");

  return `| ${headerRow} |\n| ${separator} |\n${dataRows}`;
}

export function jsonToDocumentation(obj) {
  const documentationSummary = obj.tables
    .map((table) => {
      return `\t- [${mdInline(table.name)}](#${mdAnchor(table.name)})`;
    })
    .join("\n");

  const documentationEntities = obj.tables
    .map((table) => {
      let enums = "";

      const fieldRows = table.fields.map((field) => {
        const sized =
          (dbToTypes[obj.database][field.type].isSized ||
            dbToTypes[obj.database][field.type].hasPrecision) &&
          field.size &&
          field.size !== "";
        const fieldType = mdInline(
          field.type + (sized ? "(" + field.size + ")" : ""),
        );

        enums +=
          field.type === "ENUM" && field.values && field.values.length > 0
            ? `##### ${mdInline(field.name)}\n\n${field.values
                .map((v) => `- ${mdInline(v)}`)
                .join("\n")}\n`
            : "";

        const settings =
          `${field.primary ? "🔑 PK, " : ""}` +
          `${field.notNull ? "not null" : "null"}` +
          `${field.unique ? ", unique" : ""}` +
          `${field.increment ? ", autoincrement" : ""}` +
          `${field.default ? `, default: ${mdInline(field.default)}` : ""}`;

        const references = relationshipByField(
          table.id,
          obj.relationships,
          field.id,
        )
          .map((n) => mdInline(n))
          .join(", ");

        return [
          `**${mdInline(field.name)}**`,
          fieldType,
          settings,
          references,
          mdInline(field.comment ?? ""),
        ];
      });

      const fieldsTable = formatMarkdownTable(
        ["Name", "Type", "Settings", "References", "Note"],
        fieldRows,
      );

      let indexesSection = "";
      if (table.indices.length > 0) {
        const indexRows = table.indices.map((index) => [
          mdInline(index.name),
          index.unique ? "✅" : "",
          index.fields.map((f) => mdInline(f)).join(", "),
        ]);
        indexesSection =
          "\n#### Indexes\n" +
          formatMarkdownTable(["Name", "Unique", "Fields"], indexRows);
      }

      let uniqueConstraintsSection = "";
      if ((table.uniqueConstraints || []).length > 0) {
        const ucRows = table.uniqueConstraints.map((uc) => [
          mdInline(uc.name),
          uc.fields.map((f) => mdInline(f)).join(", "),
        ]);
        uniqueConstraintsSection =
          "\n#### Unique constraints\n" +
          formatMarkdownTable(["Name", "Fields"], ucRows);
      }

      return (
        `### ${mdInline(table.name)}\n${table.comment ? mdBlock(table.comment) : ""}\n` +
        `${fieldsTable} \n${enums.length > 0 ? "\n#### Enums\n" + enums : ""}\n` +
        indexesSection +
        uniqueConstraintsSection
      );
    })
    .join("\n");

  function relationshipByField(table, relationships, fieldId) {
    return relationships
      .filter(
        (r) =>
          r.startTableId === table &&
          getRelationshipFields(r).some((p) => p.startFieldId === fieldId),
      )
      .map((rel) => rel.name);
  }

  const documentationRelationships = obj.relationships?.length
    ? obj.relationships
        .map((r) => {
          const startTable = obj.tables.find(
            (t) => t.id === r.startTableId,
          ).name;
          const endTable = obj.tables.find((t) => t.id === r.endTableId).name;
          return `- **${mdInline(startTable)} to ${mdInline(endTable)}**: ${mdInline(r.cardinality)}\n`;
        })
        .join("")
    : "";

  const documentationTypes =
    databases[obj.database].hasTypes && obj.types.length > 0
      ? obj.types
          .map((type) => {
            const rows = [
              [
                mdInline(type.name),
                type.fields.map((f) => mdInline(f.name)).join(", "),
                mdInline(type.comment ?? ""),
              ],
            ];
            return formatMarkdownTable(["Name", "Fields", "Note"], rows);
          })
          .join("\n")
      : "";

  return (
    `# ${mdInline(obj.title)} documentation\n## Summary\n\n- [Introduction](#introduction)\n- [Database Type](#database-type)\n` +
    `- [Table Structure](#table-structure)\n${documentationSummary}\n- [Relationships](#relationships)\n- [Database Diagram](#database-diagram)\n\n` +
    `## Introduction\n\n## Database type\n\n- **Database system:** ` +
    `${databases[obj.database].name}\n## Table structure\n\n${documentationEntities}` +
    `\n## Relationships\n\n${documentationRelationships}\n` +
    `${databases[obj.database].hasTypes && obj.types.length > 0 ? `## Types\n\n` + documentationTypes + `\n\n` : ""}` +
    `## Database Diagram\n\n\`\`\`mermaid\n${jsonToMermaid(obj)}\n\`\`\``
  );
}
