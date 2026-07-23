import { isPlainObject } from "./protocol.js";

// Structural gate mirroring the client diagram schema's `required` arrays.
// Rejects hostile/opaque blobs before they are persisted or rebroadcast to peers.
//
// The fork uses two different key names for the same fields depending on
// context: the wire form sent by Workspace.jsx's buildDocument() (and read
// back by applyDiagramState) uses `references`/`areas`, while the schema
// form (src/data/schemas/diagram.js) uses `relationships`/`subjectAreas`.
// Accept either alias for each field — this is a coarse shape check, not a
// strict schema validator.
export function isDiagramDocument(document) {
  if (!isPlainObject(document)) return false;
  if (!Array.isArray(document.tables)) return false;
  if (!Array.isArray(document.notes)) return false;
  if (
    !Array.isArray(document.references) &&
    !Array.isArray(document.relationships)
  )
    return false;
  if (!Array.isArray(document.areas) && !Array.isArray(document.subjectAreas))
    return false;
  return true;
}
