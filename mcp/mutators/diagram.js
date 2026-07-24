// Whole-document read/replace. getDiagram is read-only; importDiagram rewrites
// the document from an incoming diagram (wire-form `references`/`areas` or
// schema-form `relationships`/`subjectAreas`), normalising to the wire form the
// collab server and browser expect (buildDocument in Workspace.jsx).

export function getDiagram(doc) {
  return doc;
}

function normalizeIncoming(incoming) {
  if (!incoming || typeof incoming !== "object")
    throw new Error("importDiagram: a diagram object is required");
  const references = incoming.references ?? incoming.relationships;
  const areas = incoming.areas ?? incoming.subjectAreas;
  if (!Array.isArray(incoming.tables))
    throw new Error("importDiagram: tables must be an array");
  if (!Array.isArray(references))
    throw new Error("importDiagram: references/relationships must be an array");
  if (!Array.isArray(incoming.notes))
    throw new Error("importDiagram: notes must be an array");
  if (!Array.isArray(areas))
    throw new Error("importDiagram: areas/subjectAreas must be an array");
  return { references, areas };
}

export function importDiagram(doc, incoming, { clearCurrent = true } = {}) {
  const { references, areas } = normalizeIncoming(incoming);
  if (clearCurrent) {
    doc.database = incoming.database ?? doc.database;
    doc.tables = incoming.tables;
    doc.references = references;
    doc.notes = incoming.notes;
    doc.areas = areas;
    if (incoming.enums !== undefined) doc.enums = incoming.enums;
    if (incoming.types !== undefined) doc.types = incoming.types;
  } else {
    doc.tables = [...doc.tables, ...incoming.tables];
    doc.references = [...(doc.references ?? []), ...references];
    doc.notes = [...(doc.notes ?? []), ...incoming.notes];
    doc.areas = [...(doc.areas ?? []), ...areas];
    if (Array.isArray(incoming.enums))
      doc.enums = [...(doc.enums ?? []), ...incoming.enums];
    if (Array.isArray(incoming.types))
      doc.types = [...(doc.types ?? []), ...incoming.types];
  }
  return {
    tables: doc.tables.length,
    references: doc.references.length,
  };
}
