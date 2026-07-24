import { Parser } from "@dbml/core";
import { nanoid } from "nanoid";
import { Cardinality, Constraint, capabilities, defaultBlue } from "./constants.js";

// DBML import/export for the MCP service.
//
// We reuse the @dbml/core *library* (Node-safe, already a dependency) rather
// than src/utils/importFrom/dbml.js, which is written for the Vite bundler
// (extensionless imports) and cannot load under plain Node. The mapping below
// mirrors that file's logic so imported diagrams match the browser's shape.

const parser = new Parser();

// Cheap grid layout so imported tables don't stack at the origin. (The browser
// uses arrangeTables; a grid is enough for a headless import.)
function arrange(tables) {
  const COLS = 4;
  const GAP = 320;
  tables.forEach((table, i) => {
    table.x = (i % COLS) * GAP;
    table.y = Math.floor(i / COLS) * GAP;
  });
}

export function applyDbml(doc, src, { clearCurrent = true } = {}) {
  if (typeof src !== "string" || !src.trim())
    throw new Error("applyDbml: a DBML string is required");
  const ast = parser.parse(src, "dbmlv2");

  const tables = [];
  const relationships = [];
  const enums = [];

  for (const schema of ast.schemas) {
    for (const table of schema.tables) {
      const parsed = {
        id: nanoid(),
        name: table.name,
        comment: table.note ?? "",
        color: table.headerColor ?? defaultBlue,
        fields: [],
        indices: [],
        uniqueConstraints: [],
        x: 0,
        y: 0,
      };
      for (const column of table.fields) {
        parsed.fields.push({
          id: nanoid(),
          name: column.name,
          type: column.type.type_name.toUpperCase(),
          default: column.dbdefault?.value ?? "",
          check: "",
          primary: !!column.pk,
          unique: !!column.pk || !!column.unique,
          notNull: !!column.not_null,
          increment: !!column.increment,
          comment: column.note ?? "",
        });
      }
      for (const idx of table.indexes ?? []) {
        parsed.indices.push({
          id: idx.id - 1,
          fields: idx.columns.map((c) => c.value),
          name: idx.name ?? `${parsed.name}_index_${idx.id - 1}`,
          unique: !!idx.unique,
        });
      }
      tables.push(parsed);
    }

    for (const ref of schema.refs) {
      const [startEp, endEp] = ref.endpoints;
      const startTable = tables.find((t) => t.name === startEp.tableName);
      const endTable = tables.find((t) => t.name === endEp.tableName);
      if (!startTable || !endTable) continue;
      const startField = startTable.fields.find(
        (f) => f.name === startEp.fieldNames[0],
      );
      const endField = endTable.fields.find(
        (f) => f.name === endEp.fieldNames[0],
      );
      if (!startField || !endField) continue;

      let cardinality = Cardinality.ONE_TO_ONE;
      if (startEp.relation === "*" && endEp.relation === "1")
        cardinality = Cardinality.MANY_TO_ONE;
      else if (startEp.relation === "1" && endEp.relation === "*")
        cardinality = Cardinality.ONE_TO_MANY;

      const cap = (v) => (v ? v[0].toUpperCase() + v.slice(1) : Constraint.NONE);
      relationships.push({
        id: nanoid(),
        name: `fk_${startTable.name}_${startField.name}_${endTable.name}`,
        startTableId: startTable.id,
        startFieldId: startField.id,
        endTableId: endTable.id,
        endFieldId: endField.id,
        cardinality,
        updateConstraint: cap(ref.onUpdate),
        deleteConstraint: cap(ref.onDelete),
      });
    }

    for (const schemaEnum of schema.enums) {
      enums.push({
        name: schemaEnum.name,
        values: schemaEnum.values.map((v) => v.name),
      });
    }
  }

  arrange(tables);

  if (clearCurrent) {
    doc.tables = tables;
    doc.references = relationships;
    doc.notes = doc.notes ?? [];
    doc.areas = doc.areas ?? [];
  } else {
    doc.tables = [...doc.tables, ...tables];
    doc.references = [...(doc.references ?? []), ...relationships];
  }
  if (capabilities(doc.database).hasEnums && enums.length)
    doc.enums = clearCurrent ? enums : [...(doc.enums ?? []), ...enums];

  return { tables: tables.length, references: relationships.length };
}

// ---- DBML export ----------------------------------------------------------

// DBML identifiers may hold spaces/punctuation only when double-quoted; bare
// word-only names stay unquoted. Embedded quotes are escaped.
function ident(name) {
  const s = String(name ?? "");
  return /^[A-Za-z_]\w*$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`;
}

function note(text) {
  return `'${String(text).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export function exportDbml(doc) {
  const lines = [];

  for (const en of doc.enums ?? []) {
    lines.push(`Enum ${ident(en.name)} {`);
    for (const v of en.values ?? []) lines.push(`  ${ident(v)}`);
    lines.push("}", "");
  }

  for (const table of doc.tables ?? []) {
    lines.push(`Table ${ident(table.name)} {`);
    for (const f of table.fields ?? []) {
      const settings = [];
      if (f.primary) settings.push("pk");
      if (f.increment) settings.push("increment");
      if (f.unique && !f.primary) settings.push("unique");
      if (f.notNull && !f.primary) settings.push("not null");
      if (f.default) settings.push(`default: ${note(f.default)}`);
      if (f.comment) settings.push(`note: ${note(f.comment)}`);
      const suffix = settings.length ? ` [${settings.join(", ")}]` : "";
      lines.push(`  ${ident(f.name)} ${f.type}${suffix}`);
    }
    lines.push("}", "");
  }

  const arrow = {
    [Cardinality.ONE_TO_ONE]: "-",
    [Cardinality.ONE_TO_MANY]: "<",
    [Cardinality.MANY_TO_ONE]: ">",
  };
  const byId = new Map((doc.tables ?? []).map((t) => [String(t.id), t]));
  const fieldName = (table, fieldId) =>
    table?.fields.find((f) => String(f.id) === String(fieldId))?.name;
  for (const r of doc.references ?? []) {
    const st = byId.get(String(r.startTableId));
    const et = byId.get(String(r.endTableId));
    const sf = fieldName(st, r.startFieldId);
    const ef = fieldName(et, r.endFieldId);
    if (!st || !et || !sf || !ef) continue;
    const op = arrow[r.cardinality] ?? ">";
    lines.push(
      `Ref: ${ident(st.name)}.${ident(sf)} ${op} ${ident(et.name)}.${ident(ef)}`,
    );
  }

  return lines.join("\n").trim() + "\n";
}
