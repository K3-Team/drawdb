export * from "./constants.js";
export * from "./entities.js";
export * from "./diagram.js";
export * from "./dbml.js";

// A fresh, valid, empty wire document for a given database.
export function emptyDocument(database = "generic") {
  return {
    database,
    tables: [],
    references: [],
    notes: [],
    areas: [],
  };
}
