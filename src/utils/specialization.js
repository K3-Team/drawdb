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

// Text for the start (child) and end (parent) badges. Look-here convention:
// each badge describes how many times the adjacent table participates.
export function badgeTexts(rel, tables) {
  if (isSubtype(rel)) {
    return { start: "⊂", end: rel.subtype?.disjoint ? "d" : "o" };
  }

  const many = rel.manyLabel || "n";
  let startMax = "1";
  let endMax = "1";

  // When participation is set, we invert many_to_one to show from parent perspective
  const cardinality = rel.participation && rel.cardinality === Cardinality.MANY_TO_ONE
    ? Cardinality.ONE_TO_MANY
    : rel.cardinality;

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

  const endMin = rel.participation.end === Participation.MANDATORY ? 1 : 0;
  const startMin = childMin(rel, tables);
  return { start: `${startMin}..${startMax}`, end: `${endMin}..${endMax}` };
}
