import { Cardinality, Participation, RelationshipKind } from "../data/constants";

// A relationship is a subtype link only when explicitly marked; absent kind
// means an ordinary foreign key (all pre-feature documents).
export function isSubtype(rel) {
  return rel?.kind === RelationshipKind.SUBTYPE;
}

// Sibling links = same supertype (end table) and same specialisation group.
// Includes `rel` itself. Empty for fk links.
export function siblingsOf(relationships, rel) {
  if (!isSubtype(rel)) return [];
  const group = rel.subtype?.group ?? "";
  return relationships.filter(
    (r) =>
      isSubtype(r) &&
      String(r.endTableId) === String(rel.endTableId) &&
      (r.subtype?.group ?? "") === group,
  );
}

// Pairs the subtype table's primary-key fields with the supertype's, in order.
// Throws when either side has no PK or the counts differ, so a subtype link is
// always a complete PK-to-PK mapping (class-table inheritance).
export function primaryKeyPairs(subtypeTable, supertypeTable) {
  const subPk = (subtypeTable?.fields ?? []).filter((f) => f.primary);
  const superPk = (supertypeTable?.fields ?? []).filter((f) => f.primary);
  if (subPk.length === 0) throw new Error(`Table "${subtypeTable?.name}" has no primary key`);
  if (superPk.length === 0) throw new Error(`Table "${supertypeTable?.name}" has no primary key`);
  if (subPk.length !== superPk.length)
    throw new Error(
      `Primary keys of "${subtypeTable.name}" (${subPk.length} columns) and "${supertypeTable.name}" (${superPk.length} columns) do not match`,
    );
  return subPk.map((f, i) => ({ startFieldId: f.id, endFieldId: superPk[i].id }));
}

export function subtypeName(subtypeTableName, supertypeTableName) {
  return `is_a_${subtypeTableName}_${supertypeTableName}`;
}

// Minimum participation of the child (start/FK-holder) side, derived from the
// FK field's NOT NULL. Unknown field → 1 (the conservative, DDL-neutral answer).
export function childMin(rel, tables) {
  const table = tables.find((t) => String(t.id) === String(rel.startTableId));
  const field = table?.fields?.find(
    (f) => String(f.id) === String(rel.startFieldId),
  );
  if (!field) return 1;
  return field.notNull || field.primary ? 1 : 0;
}

// Old documents may carry a translated cardinality label ("Many to one");
// fold it back to the enum form so legacy diagrams keep their n badge.
export function normalizeCardinality(rel) {
  return String(rel.cardinality ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

// Text for the start (child) and end (parent) badges. Look-across convention (same as the legacy 1 / n badges): each badge describes how many rows of the adjacent table exist per row of the table at the far end.
export function badgeTexts(rel, tables) {
  if (isSubtype(rel)) {
    return { start: "⊂", end: rel.subtype?.disjoint ? "d" : "o" };
  }

  const many = rel.manyLabel || "n";
  let startMax = "1";
  let endMax = "1";
  const cardinality = normalizeCardinality(rel);
  switch (cardinality) {
    case Cardinality.MANY_TO_ONE:
      startMax = many;
      break;
    case Cardinality.ONE_TO_MANY:
      endMax = many;
      break;
    default:
      break;
  }

  if (!rel.participation) return { start: startMax, end: endMax };

  // Look-across, like the legacy 1 / n badges: the badge beside the child
  // (start) table reads "children per parent", so its min is the parent's
  // participation; the badge beside the parent reads "parents per child",
  // so its min is the FK's NOT NULL.
  const startMin = rel.participation.end === Participation.MANDATORY ? 1 : 0;
  const endMin = childMin(rel, tables);
  return { start: `${startMin}..${startMax}`, end: `${endMin}..${endMax}` };
}
