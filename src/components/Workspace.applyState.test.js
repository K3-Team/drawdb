import { describe, it, expect } from "vitest";
import { jsonDiagramIsValid } from "../utils/validateSchema";

// The wire document produced by Workspace.buildDocument() uses the fork's
// `references`/`areas` keys, which the diagram schema does not know about (it
// requires `relationships`/`subjectAreas`). applyDiagramState normalizes to the
// schema keys before validating; these tests exercise that same predicate on
// the normalized shape, so a too-strict guard (which would reject every
// legitimate collab load) is caught here.
const normalize = (d) =>
  d && typeof d === "object" && !Array.isArray(d)
    ? {
        ...d,
        relationships: d.references ?? d.relationships,
        subjectAreas: d.areas ?? d.subjectAreas,
      }
    : d;

describe("collab document validation (applyDiagramState guard)", () => {
  it("rejects a structurally malformed document", () => {
    expect(jsonDiagramIsValid(normalize({ tables: "x" }))).toBe(false);
    expect(jsonDiagramIsValid(normalize(null))).toBe(false);
    expect(jsonDiagramIsValid(normalize({}))).toBe(false);
  });

  it("accepts a minimal well-formed diagram", () => {
    expect(
      jsonDiagramIsValid({
        tables: [],
        relationships: [],
        notes: [],
        subjectAreas: [],
      }),
    ).toBe(true);
  });

  it("accepts the empty real wire document (references/areas) once normalized", () => {
    const wire = {
      database: "generic",
      tables: [],
      references: [],
      notes: [],
      areas: [],
      pan: { x: 0, y: 0 },
      zoom: 1,
    };
    expect(jsonDiagramIsValid(normalize(wire))).toBe(true);
  });

  it("accepts a non-empty realistic wire document once normalized", () => {
    const wire = {
      database: "generic",
      tables: [
        {
          id: "abc",
          name: "table_abc",
          x: 10,
          y: 20,
          locked: false,
          fields: [
            {
              id: "f1",
              name: "id",
              type: "INT",
              default: "",
              check: "",
              primary: true,
              unique: false,
              notNull: true,
              increment: true,
              comment: "",
            },
          ],
          comment: "",
          indices: [],
          uniqueConstraints: [],
          color: "#175e7a",
          collapsed: false,
        },
      ],
      references: [
        {
          id: "r1",
          name: "fk",
          startTableId: "abc",
          startFieldId: "f1",
          endTableId: "abc",
          endFieldId: "f1",
          cardinality: "one_to_one",
          updateConstraint: "No action",
          deleteConstraint: "No action",
        },
      ],
      notes: [],
      areas: [
        {
          id: 0,
          name: "area",
          x: 1,
          y: 2,
          width: 100,
          height: 50,
          color: "#ffffff",
        },
      ],
      enums: [{ name: "mood", values: ["happy", "sad"] }],
      types: [],
      pan: { x: 0, y: 0 },
      zoom: 1,
    };
    expect(jsonDiagramIsValid(normalize(wire))).toBe(true);
  });
});
