import { Cardinality } from "../../data/constants";
import { dbToTypes } from "../../data/datatypes";
import i18n from "../../i18n/i18n";
import { mermaidToken } from "./escape";

export function jsonToMermaid(obj) {
  function getMermaidRelationship(relationship) {
    switch (relationship) {
      case i18n.t(Cardinality.ONE_TO_ONE):
      case Cardinality.ONE_TO_ONE:
        return "||--||";
      case i18n.t(Cardinality.MANY_TO_ONE_TO_ONE):
      case Cardinality.MANY_TO_ONE:
        return "}o--||";
      case i18n.t(Cardinality.ONE_TO_MANY):
      case Cardinality.ONE_TO_MANY:
        return "||--o{";
      default:
        return "--";
    }
  }

  const mermaidEntities = obj.tables
    .map((table) => {
      const fields = table.fields
        .map((field) => {
          const sized =
            (dbToTypes[obj.database][field.type].isSized ||
              dbToTypes[obj.database][field.type].hasPrecision) &&
            /^[0-9, ]+$/.test(String(field.size ?? "").trim());
          const fieldType =
            mermaidToken(field.type) +
            (sized ? "(" + String(field.size).trim() + ")" : "");
          return `\t\t${fieldType} ${mermaidToken(field.name)}`;
        })
        .join("\n");
      return `\t${mermaidToken(table.name)} {\n${fields}\n\t}`;
    })
    .join("\n\n");

  const mermaidRelationships = obj.relationships?.length
    ? obj.relationships
        .map((r) => {
          const startTable = obj.tables.find(
            (t) => t.id === r.startTableId,
          ).name;
          const endTable = obj.tables.find((t) => t.id === r.endTableId).name;
          return `\t${mermaidToken(startTable)} ${getMermaidRelationship(r.cardinality)} ${mermaidToken(endTable)} : references`;
        })
        .join("\n")
    : "";

  return `erDiagram\n${mermaidRelationships ? `${mermaidRelationships}\n\n` : ""}${mermaidEntities}`;
}
