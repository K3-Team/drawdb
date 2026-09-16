// Node mirror of src/utils/specialization.js (the client file uses Vite-style
// extensionless imports). Keep the two in sync.
import {
  RelationshipKind,
  VALID_KINDS,
  VALID_PARTICIPATIONS,
} from "./constants.js";

export function isSubtype(rel) {
  return rel?.kind === RelationshipKind.SUBTYPE;
}

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

export function normalizeKind(kind) {
  if (kind === undefined) return RelationshipKind.FK;
  if (!VALID_KINDS.includes(kind)) throw new Error(`Invalid kind: ${kind}`);
  return kind;
}

// Validates and fills a subtype block. `supertype` is the end table, used to
// check the discriminator exists.
export function normalizeSubtype(input, supertype) {
  if (!input || typeof input !== "object")
    throw new Error("subtype requires { group, disjoint, total }");
  const group = typeof input.group === "string" ? input.group : "";
  const out = {
    group,
    disjoint: !!input.disjoint,
    total: !!input.total,
  };
  if (input.discriminatorFieldId !== undefined && input.discriminatorFieldId !== null) {
    const ok = supertype.fields.some(
      (f) => String(f.id) === String(input.discriminatorFieldId),
    );
    if (!ok)
      throw new Error(`Discriminator field not found: ${input.discriminatorFieldId}`);
    out.discriminatorFieldId = input.discriminatorFieldId;
  }
  return out;
}

export function normalizeParticipation(input) {
  if (!input || typeof input !== "object" || input.end === undefined)
    throw new Error('participation requires { end: "optional" | "mandatory" }');
  if (!VALID_PARTICIPATIONS.includes(input.end))
    throw new Error(`Invalid participation: ${input.end}`);
  return { end: input.end };
}
