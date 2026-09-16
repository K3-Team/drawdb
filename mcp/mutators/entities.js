import { nanoid } from "nanoid";
import {
  Cardinality,
  Constraint,
  capabilities,
  defaultBlue,
  defaultNoteTheme,
  VALID_CARDINALITIES,
  VALID_CONSTRAINTS,
  VALID_DATABASES,
  RelationshipKind,
} from "./constants.js";
import {
  isSubtype,
  siblingsOf,
  subtypeName,
  normalizeKind,
  normalizeSubtype,
  normalizeParticipation,
  primaryKeyPairs,
} from "./specialization.js";

// Pure transforms over the wire document
// ({ database, tables, references, notes, areas, enums?, types? }). Each
// mutator mutates the document in place and returns a useful value (a new id,
// the affected entity, or undefined); read helpers never mutate. All throw a
// plain Error with a clear message on not-found / invalid input so the MCP
// layer can surface it to the model. The server re-validates every write
// (isDiagramDocument) and export-time escaping neutralises hostile strings, so
// these do shape/existence checks, not identifier sanitisation.

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function requireColor(color, fallback) {
  if (color === undefined || color === null) return fallback;
  if (typeof color !== "string" || !HEX_COLOR.test(color)) {
    throw new Error(`Invalid color "${color}"; expected #rrggbb`);
  }
  return color;
}

function findTable(doc, id) {
  const table = doc.tables.find((t) => String(t.id) === String(id));
  if (!table) throw new Error(`Table not found: ${id}`);
  return table;
}

// The wire document stores relationships under `references`. Accept the schema
// alias `relationships` too, but always write back through `references`.
function relationshipsOf(doc) {
  if (!Array.isArray(doc.references)) doc.references = doc.references ?? [];
  return doc.references;
}

// ---- fields ---------------------------------------------------------------

function normalizeField(input) {
  if (!input || typeof input.name !== "string" || !input.name)
    throw new Error("Field requires a name");
  if (typeof input.type !== "string" || !input.type)
    throw new Error(`Field "${input.name}" requires a type`);
  return {
    id: input.id ?? nanoid(),
    name: input.name,
    type: input.type.toUpperCase(),
    default: input.default ?? "",
    check: input.check ?? "",
    primary: !!input.primary,
    unique: !!input.unique,
    notNull: !!input.notNull,
    increment: !!input.increment,
    comment: input.comment ?? "",
    ...(input.size !== undefined && { size: input.size }),
    ...(input.values !== undefined && { values: input.values }),
    ...(input.unsigned !== undefined && { unsigned: !!input.unsigned }),
  };
}

// ---- tables ---------------------------------------------------------------

export function addTable(doc, { name, x, y, fields, color, comment } = {}) {
  if (typeof name !== "string" || !name.trim())
    throw new Error("Table requires a name");
  const id = nanoid();
  const table = {
    id,
    name,
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    fields:
      Array.isArray(fields) && fields.length > 0
        ? fields.map((f) => normalizeField(f))
        : [
            normalizeField(
              {
                name: "id",
                type: doc.database === "generic" ? "INT" : "INTEGER",
                primary: true,
                notNull: true,
                increment: true,
              },
            ),
          ],
    comment: comment ?? "",
    indices: [],
    uniqueConstraints: [],
    color: requireColor(color, defaultBlue),
  };
  doc.tables.push(table);
  return { id, fieldIds: table.fields.map((f) => ({ name: f.name, id: f.id })) };
}

export function updateTable(doc, id, updates = {}) {
  const table = findTable(doc, id);
  const allowed = ["name", "x", "y", "comment", "color"];
  for (const key of allowed) {
    if (updates[key] === undefined) continue;
    table[key] = key === "color" ? requireColor(updates[key], table.color) : updates[key];
  }
  if (updates.fields !== undefined) {
    if (!Array.isArray(updates.fields))
      throw new Error("updateTable: fields must be an array");
    table.fields = updates.fields.map((f) =>
      normalizeField(f),
    );
  }
  return { id: table.id };
}

export function deleteTable(doc, id) {
  const before = doc.tables.length;
  doc.tables = doc.tables.filter((t) => String(t.id) !== String(id));
  if (doc.tables.length === before) throw new Error(`Table not found: ${id}`);
  // Drop relationships that referenced the removed table.
  const refs = relationshipsOf(doc);
  doc.references = refs.filter(
    (r) =>
      String(r.startTableId) !== String(id) &&
      String(r.endTableId) !== String(id),
  );
  return { id };
}

export function getTable(doc, { tableId, tableName } = {}) {
  let table = null;
  if (tableId !== undefined)
    table = doc.tables.find((t) => String(t.id) === String(tableId));
  else if (tableName !== undefined)
    table = doc.tables.find((t) => t.name === tableName);
  if (!table) throw new Error(`Table not found: ${tableId ?? tableName}`);
  return table;
}

// ---- table fields ---------------------------------------------------------

export function addField(doc, tableId, field) {
  const table = findTable(doc, tableId);
  const normalized = normalizeField(field);
  table.fields.push(normalized);
  return { id: normalized.id };
}

export function updateField(doc, tableId, fieldId, updates = {}) {
  const table = findTable(doc, tableId);
  const field = table.fields.find((f) => String(f.id) === String(fieldId));
  if (!field) throw new Error(`Field not found: ${fieldId}`);
  const merged = normalizeField({ ...field, ...updates, id: field.id });
  Object.assign(field, merged);
  return { id: field.id };
}

export function deleteField(doc, tableId, fieldId) {
  const table = findTable(doc, tableId);
  const before = table.fields.length;
  table.fields = table.fields.filter((f) => String(f.id) !== String(fieldId));
  if (table.fields.length === before)
    throw new Error(`Field not found: ${fieldId}`);
  return { id: fieldId };
}

// ---- relationships --------------------------------------------------------

// Two field mappings are the same pairing regardless of the order they were
// listed in, so compare the sorted id sets of each side.
function sameFieldMapping(a, b) {
  const key = (pairs) =>
    JSON.stringify([
      pairs.map((p) => String(p.startFieldId)).sort(),
      pairs.map((p) => String(p.endFieldId)).sort(),
    ]);
  return key(a) === key(b);
}

// Resolves the subtype block for `rel` joining the specialisation group named
// in `suppliedSubtype` (or keeping its own) and keeps the whole group on one
// block: adopt the group's block when no full block is supplied, otherwise
// propagate the supplied one to every sibling. Shared by addRelationship, the
// kind switch and the subtype update so the three paths cannot drift.
function resolveGroupBlock(refs, rel, endTable, suppliedSubtype) {
  const group = suppliedSubtype?.group ?? rel.subtype?.group ?? "";
  const siblings = siblingsOf(refs, {
    kind: RelationshipKind.SUBTYPE,
    endTableId: rel.endTableId,
    subtype: { group },
  }).filter((s) => s !== rel);
  const hasFullBlock =
    suppliedSubtype !== undefined &&
    suppliedSubtype.disjoint !== undefined &&
    suppliedSubtype.total !== undefined;
  const block =
    siblings.length > 0 && !hasFullBlock
      ? { ...siblings[0].subtype, group }
      : normalizeSubtype({ ...rel.subtype, ...suppliedSubtype, group }, endTable);
  for (const sibling of siblings) sibling.subtype = { ...block };
  return block;
}

export function addRelationship(doc, data = {}) {
  const {
    startTableId,
    startFieldId,
    endTableId,
    endFieldId,
    fields,
    name,
    cardinality = Cardinality.ONE_TO_MANY,
    updateConstraint = Constraint.NONE,
    deleteConstraint,
    kind: rawKind,
    subtype,
    participation,
  } = data;
  const start = findTable(doc, startTableId);
  const end = findTable(doc, endTableId);
  if (!start.fields.some((f) => String(f.id) === String(startFieldId)))
    throw new Error(`Start field not found: ${startFieldId}`);
  if (!end.fields.some((f) => String(f.id) === String(endFieldId)))
    throw new Error(`End field not found: ${endFieldId}`);
  // An optional composite mapping; startFieldId/endFieldId mirror its first pair.
  let pairs;
  if (fields !== undefined && fields !== null) {
    if (!Array.isArray(fields) || fields.length === 0)
      throw new Error("fields must be a non-empty array of { startFieldId, endFieldId }");
    for (const pair of fields) {
      if (!start.fields.some((f) => String(f.id) === String(pair?.startFieldId)))
        throw new Error(`Start field not found: ${pair?.startFieldId}`);
      if (!end.fields.some((f) => String(f.id) === String(pair?.endFieldId)))
        throw new Error(`End field not found: ${pair?.endFieldId}`);
    }
    pairs = fields.map((p) => ({
      startFieldId: p.startFieldId,
      endFieldId: p.endFieldId,
    }));
  }
  const kind = normalizeKind(rawKind);
  if (!VALID_CARDINALITIES.includes(cardinality))
    throw new Error(`Invalid cardinality: ${cardinality}`);
  if (!VALID_CONSTRAINTS.includes(updateConstraint))
    throw new Error(`Invalid updateConstraint: ${updateConstraint}`);
  const del =
    deleteConstraint ??
    (kind === RelationshipKind.SUBTYPE ? Constraint.CASCADE : Constraint.NONE);
  if (!VALID_CONSTRAINTS.includes(del))
    throw new Error(`Invalid deleteConstraint: ${del}`);

  const id = nanoid();
  const rel = {
    id,
    name:
      name ??
      (kind === RelationshipKind.SUBTYPE
        ? subtypeName(start.name, end.name)
        : `fk_${start.name}_${end.name}`),
    startTableId,
    startFieldId,
    endTableId,
    endFieldId,
    ...(pairs && { fields: pairs }),
    cardinality: kind === RelationshipKind.SUBTYPE ? Cardinality.ONE_TO_ONE : cardinality,
    updateConstraint,
    deleteConstraint: del,
  };
  if (participation !== undefined && participation !== null) {
    if (kind === RelationshipKind.SUBTYPE)
      throw new Error("participation applies to fk links only");
    rel.participation = normalizeParticipation(participation);
  }
  if (kind === RelationshipKind.SUBTYPE) {
    const supplied = pairs ?? [{ startFieldId, endFieldId }];
    if (!sameFieldMapping(primaryKeyPairs(start, end), supplied))
      throw new Error(
        "subtype links must map the subtype primary key to the supertype primary key",
      );
    rel.kind = kind;
    rel.subtype = resolveGroupBlock(relationshipsOf(doc), rel, end, subtype ?? {});
  }
  relationshipsOf(doc).push(rel);
  return { id };
}

export function updateRelationship(doc, id, updates = {}) {
  const refs = relationshipsOf(doc);
  const rel = refs.find((r) => String(r.id) === String(id));
  if (!rel) throw new Error(`Relationship not found: ${id}`);

  if (updates.kind !== undefined) {
    const kind = normalizeKind(updates.kind);
    if (kind === RelationshipKind.SUBTYPE) {
      const end = findTable(doc, rel.endTableId);
      // A subtype link is a full PK-to-PK mapping, so remap the endpoints;
      // this throws (leaving the document untouched, the collab client works
      // on a clone) when either table has no primary key or the widths differ.
      const pkPairs = primaryKeyPairs(findTable(doc, rel.startTableId), end);
      rel.kind = kind;
      rel.cardinality = Cardinality.ONE_TO_ONE;
      if (rel.deleteConstraint === Constraint.NONE)
        rel.deleteConstraint = Constraint.CASCADE;
      delete rel.participation;
      rel.startFieldId = pkPairs[0].startFieldId;
      rel.endFieldId = pkPairs[0].endFieldId;
      rel.fields = pkPairs;
      rel.subtype = resolveGroupBlock(refs, rel, end, updates.subtype);
    } else {
      delete rel.kind;
      delete rel.subtype;
    }
  }
  if (updates.cardinality !== undefined) {
    if (!VALID_CARDINALITIES.includes(updates.cardinality))
      throw new Error(`Invalid cardinality: ${updates.cardinality}`);
    if (isSubtype(rel) && updates.cardinality !== Cardinality.ONE_TO_ONE)
      throw new Error("subtype links are always one_to_one");
    rel.cardinality = updates.cardinality;
  }
  for (const key of ["updateConstraint", "deleteConstraint"]) {
    if (updates[key] === undefined) continue;
    if (!VALID_CONSTRAINTS.includes(updates[key]))
      throw new Error(`Invalid ${key}: ${updates[key]}`);
    rel[key] = updates[key];
  }
  if (updates.name !== undefined) rel.name = updates.name;

  if (updates.subtype !== undefined && updates.kind === undefined) {
    if (!isSubtype(rel)) throw new Error("subtype can only be set on a subtype link");
    const end = findTable(doc, rel.endTableId);
    rel.subtype = resolveGroupBlock(refs, rel, end, updates.subtype);
  }

  if (updates.participation !== undefined) {
    if (updates.participation === null) delete rel.participation;
    else if (isSubtype(rel))
      throw new Error("participation applies to fk links only");
    else rel.participation = normalizeParticipation(updates.participation);
  }
  return { id };
}

export function addSpecialization(doc, data = {}) {
  const { supertypeTableId, subtypeTableIds, group = "", disjoint = false, total = false, discriminatorFieldId } = data;
  if (!Array.isArray(subtypeTableIds) || subtypeTableIds.length === 0)
    throw new Error("subtypeTableIds must be a non-empty array");
  const superT = findTable(doc, supertypeTableId);
  const uniqueIds = [...new Set(subtypeTableIds.map(String))];
  const resolved = uniqueIds.map((subId) => {
    if (String(subId) === String(supertypeTableId))
      throw new Error("Subtype table cannot be its own supertype");
    const subT = findTable(doc, subId);
    return { subT, pairs: primaryKeyPairs(subT, superT) };
  });
  const ids = [];
  for (const { subT, pairs } of resolved) {
    const { id } = addRelationship(doc, {
      startTableId: subT.id,
      startFieldId: pairs[0].startFieldId,
      endTableId: superT.id,
      endFieldId: pairs[0].endFieldId,
      fields: pairs,
      kind: RelationshipKind.SUBTYPE,
      subtype: { group, disjoint, total, discriminatorFieldId },
    });
    ids.push(id);
  }
  return { ids };
}

export function updateSpecialization(doc, data = {}) {
  const { supertypeTableId, group = "", updates = {} } = data;
  const superT = findTable(doc, supertypeTableId);
  const refs = relationshipsOf(doc);
  const probe = { kind: RelationshipKind.SUBTYPE, endTableId: superT.id, subtype: { group } };
  const siblings = siblingsOf(refs, probe);
  if (siblings.length === 0)
    throw new Error(`No specialisation "${group}" on table "${superT.name}"`);
  const merged = normalizeSubtype({ ...siblings[0].subtype, ...updates }, superT);
  // Renaming onto a group that already has members merges the two: the block
  // has to cover the union, or that group would end up with two blocks.
  const targets =
    merged.group === group
      ? siblings
      : [
          ...siblings,
          ...siblingsOf(refs, {
            kind: RelationshipKind.SUBTYPE,
            endTableId: superT.id,
            subtype: { group: merged.group },
          }),
        ];
  for (const rel of targets) rel.subtype = { ...merged };
  return { ids: targets.map((r) => r.id) };
}

export function deleteRelationship(doc, id) {
  const refs = relationshipsOf(doc);
  const before = refs.length;
  doc.references = refs.filter((r) => String(r.id) !== String(id));
  if (doc.references.length === before)
    throw new Error(`Relationship not found: ${id}`);
  return { id };
}

// ---- areas & notes (positional integer ids == array index) ----------------

function reindex(list) {
  return list.map((item, i) => ({ ...item, id: i }));
}

export function addArea(doc, { name, x, y, width, height, color } = {}) {
  if (!Array.isArray(doc.areas)) doc.areas = [];
  const id = doc.areas.length;
  doc.areas.push({
    id,
    name: name ?? `area_${id}`,
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    width: Number.isFinite(width) ? width : 200,
    height: Number.isFinite(height) ? height : 200,
    color: requireColor(color, defaultBlue),
  });
  return { id };
}

export function updateArea(doc, id, updates = {}) {
  const area = (doc.areas ?? []).find((a) => a.id === Number(id));
  if (!area) throw new Error(`Area not found: ${id}`);
  for (const key of ["name", "x", "y", "width", "height"]) {
    if (updates[key] !== undefined) area[key] = updates[key];
  }
  if (updates.color !== undefined) area.color = requireColor(updates.color, area.color);
  return { id: area.id };
}

export function deleteArea(doc, id) {
  const before = (doc.areas ?? []).length;
  doc.areas = reindex((doc.areas ?? []).filter((a) => a.id !== Number(id)));
  if (doc.areas.length === before) throw new Error(`Area not found: ${id}`);
  return { id };
}

export function addNote(doc, { title, content, x, y, width, height, color } = {}) {
  if (!Array.isArray(doc.notes)) doc.notes = [];
  const id = doc.notes.length;
  doc.notes.push({
    id,
    title: title ?? `note_${id}`,
    content: content ?? "",
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    width: Number.isFinite(width) ? width : 180,
    height: Number.isFinite(height) ? height : 88,
    color: requireColor(color, defaultNoteTheme),
  });
  return { id };
}

export function updateNote(doc, id, updates = {}) {
  const note = (doc.notes ?? []).find((n) => n.id === Number(id));
  if (!note) throw new Error(`Note not found: ${id}`);
  for (const key of ["title", "content", "x", "y", "width", "height"]) {
    if (updates[key] !== undefined) note[key] = updates[key];
  }
  if (updates.color !== undefined) note.color = requireColor(updates.color, note.color);
  return { id: note.id };
}

export function deleteNote(doc, id) {
  const before = (doc.notes ?? []).length;
  doc.notes = reindex((doc.notes ?? []).filter((n) => n.id !== Number(id)));
  if (doc.notes.length === before) throw new Error(`Note not found: ${id}`);
  return { id };
}

// ---- enums & types (addressed by name; gated on database capability) ------

function requireEnums(doc) {
  if (!capabilities(doc.database).hasEnums)
    throw new Error(`Database "${doc.database}" does not support enums`);
  if (!Array.isArray(doc.enums)) doc.enums = [];
  return doc.enums;
}

function requireTypes(doc) {
  if (!capabilities(doc.database).hasTypes)
    throw new Error(`Database "${doc.database}" does not support types`);
  if (!Array.isArray(doc.types)) doc.types = [];
  return doc.types;
}

export function addEnum(doc, { name, values } = {}) {
  const enums = requireEnums(doc);
  if (typeof name !== "string" || !name) throw new Error("Enum requires a name");
  if (enums.some((e) => e.name === name))
    throw new Error(`Enum already exists: ${name}`);
  enums.push({ name, values: Array.isArray(values) ? values : [] });
  return { name };
}

export function updateEnum(doc, name, updates = {}) {
  const enums = requireEnums(doc);
  const found = enums.find((e) => e.name === name);
  if (!found) throw new Error(`Enum not found: ${name}`);
  if (updates.name !== undefined) found.name = updates.name;
  if (updates.values !== undefined) {
    if (!Array.isArray(updates.values))
      throw new Error("updateEnum: values must be an array");
    found.values = updates.values;
  }
  return { name: found.name };
}

export function deleteEnum(doc, name) {
  const enums = requireEnums(doc);
  const before = enums.length;
  doc.enums = enums.filter((e) => e.name !== name);
  if (doc.enums.length === before) throw new Error(`Enum not found: ${name}`);
  return { name };
}

export function addType(doc, { name, fields, comment } = {}) {
  const types = requireTypes(doc);
  if (typeof name !== "string" || !name) throw new Error("Type requires a name");
  if (types.some((tp) => tp.name === name))
    throw new Error(`Type already exists: ${name}`);
  types.push({
    id: nanoid(),
    name,
    comment: comment ?? "",
    fields: (Array.isArray(fields) ? fields : []).map((f) => {
      if (!f || typeof f.name !== "string" || typeof f.type !== "string")
        throw new Error("Type field requires a name and type");
      return { id: nanoid(), name: f.name, type: f.type.toUpperCase() };
    }),
  });
  return { name };
}

export function updateType(doc, name, updates = {}) {
  const types = requireTypes(doc);
  const found = types.find((tp) => tp.name === name);
  if (!found) throw new Error(`Type not found: ${name}`);
  if (updates.name !== undefined) found.name = updates.name;
  if (updates.comment !== undefined) found.comment = updates.comment;
  if (updates.fields !== undefined) {
    if (!Array.isArray(updates.fields))
      throw new Error("updateType: fields must be an array");
    found.fields = updates.fields.map((f) => {
      if (!f || typeof f.name !== "string" || typeof f.type !== "string")
        throw new Error("Type field requires a name and type");
      return { id: f.id ?? nanoid(), name: f.name, type: f.type.toUpperCase() };
    });
  }
  return { name: found.name };
}

export function deleteType(doc, name) {
  const types = requireTypes(doc);
  const before = types.length;
  doc.types = types.filter((tp) => tp.name !== name);
  if (doc.types.length === before) throw new Error(`Type not found: ${name}`);
  return { name };
}

// ---- database -------------------------------------------------------------

export function setDatabase(doc, database) {
  if (!VALID_DATABASES.includes(database))
    throw new Error(
      `Invalid database "${database}"; expected one of ${VALID_DATABASES.join(", ")}`,
    );
  doc.database = database;
  // Dropping into a database without enum/type support would leave orphaned
  // entities the exporters can't represent; clear them so the document stays
  // consistent with its declared capabilities.
  const caps = capabilities(database);
  if (!caps.hasEnums) delete doc.enums;
  if (!caps.hasTypes) delete doc.types;
  return { database };
}
