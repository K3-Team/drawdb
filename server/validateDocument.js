import { isPlainObject } from "./protocol.js";

const REQUIRED_ARRAYS = ["tables", "relationships", "notes", "subjectAreas"];

// Structural gate mirroring the client diagram schema's `required` arrays.
// Rejects hostile/opaque blobs before they are persisted or rebroadcast to peers.
export function isDiagramDocument(document) {
  if (!isPlainObject(document)) return false;
  for (const key of REQUIRED_ARRAYS) {
    if (!Array.isArray(document[key])) return false;
  }
  return true;
}
