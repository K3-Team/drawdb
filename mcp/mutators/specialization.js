// Node mirror of src/utils/specialization.js (the client file uses Vite-style
// extensionless imports). Keep the two in sync.
// The badge/label helpers (childMin, normalizeCardinality, badgeTexts) are
// deliberately not mirrored: MCP never renders badges, so it needs neither the
// composite-FK nullability rule nor the localised legacy cardinality labels.
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

// Mirrors IDENTIFIER_PATTERN in src/data/schemas.js: no control characters,
// and none of the characters that could break out of a quoted/DBML context.
// eslint-disable-next-line no-control-regex
const IDENTIFIER_RE = /^[^\u0000-\u001F\u007F"`\];]*$/;

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
  if (!IDENTIFIER_RE.test(group)) throw new Error(`Invalid group: ${group}`);
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
