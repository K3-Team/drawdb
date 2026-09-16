import { Cardinality } from "../../data/constants";
import { dbToTypes } from "../../data/datatypes";
import i18n from "../../i18n/i18n";
import { mermaidToken } from "./escape";
import { childMin, isSubtype, normalizeCardinality } from "../specialization";

export function jsonToMermaid(obj) {
  // Legacy: bare cardinality with no participation info.
  function getMermaidRelationship(relationship) {
    switch (relationship) {
      case i18n.t(Cardinality.ONE_TO_ONE):
      case Cardinality.ONE_TO_ONE:
        return "||--||";
      case i18n.t(Cardinality.MANY_TO_ONE):
      case Cardinality.MANY_TO_ONE:
        return "}o--||";
      case i18n.t(Cardinality.ONE_TO_MANY):
      case Cardinality.ONE_TO_MANY:
        return "||--o{";
      default:
        return "--";
    }
  }

  // With participation: left = start (child) table, right = end (parent).
  // Mermaid marks are look-across, matching badgeTexts: the mark beside the
  // child says children-per-parent (min from the parent's participation),
  // the mark beside the parent says parents-per-child (min from NOT NULL).
  function getMermaidParticipation(r) {
    const startMin = r.participation.end === "mandatory" ? 1 : 0;
    const endMin = childMin(r, obj.tables);
    const cardinality = normalizeCardinality(r);
    const startMany = cardinality === Cardinality.MANY_TO_ONE;
    const endMany = cardinality === Cardinality.ONE_TO_MANY;
    const left = startMany ? (startMin ? "}|" : "}o") : startMin ? "||" : "|o";
    const right = endMany ? (endMin ? "|{" : "o{") : endMin ? "||" : "o|";
    return `${left}--${right}`;
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
          const link = isSubtype(r)
            ? "||--||"
            : r.participation
              ? getMermaidParticipation(r)
              : getMermaidRelationship(r.cardinality);
          const label = isSubtype(r) ? "is_a" : "references";
          return `\t${mermaidToken(startTable)} ${link} ${mermaidToken(endTable)} : ${label}`;
        })
        .join("\n")
    : "";

  return `erDiagram\n${mermaidRelationships ? `${mermaidRelationships}\n\n` : ""}${mermaidEntities}`;
}
