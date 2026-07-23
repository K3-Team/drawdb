import { describe, it, expect } from "vitest";
import { jsonDiagramIsValid, ddbDiagramIsValid } from "./validateSchema";

// jsonDiagramIsValid gates the ?shareId= import path (Workspace.jsx
// loadFromGist), so a hostile shared diagram is rejected before its data can
// reach the SQL exporters.
const base = (table) => ({
  tables: [table],
  relationships: [],
  notes: [],
  subjectAreas: [],
});
const okTable = (over = {}) => ({
  id: 0,
  name: "users",
  x: 0,
  y: 0,
  comment: "",
  color: "#000000",
  indices: [],
  fields: [],
  ...over,
});
const okField = (over = {}) => ({
  id: 0,
  name: "c",
  type: "VARCHAR",
  default: "",
  check: "",
  primary: false,
  unique: false,
  notNull: false,
  increment: false,
  comment: "",
  ...over,
});

describe("jsonDiagramIsValid gates the shared-diagram path", () => {
  it("accepts a clean diagram", () => {
    expect(jsonDiagramIsValid(base(okTable({ fields: [okField()] })))).toBe(
      true,
    );
  });

  it("rejects a table name that could break out of a quoted identifier", () => {
    expect(
      jsonDiagramIsValid(
        base(okTable({ name: "users`; DROP DATABASE prod; -- " })),
      ),
    ).toBe(false);
  });

  it("rejects a hostile field size", () => {
    expect(
      jsonDiagramIsValid(
        base(
          okTable({ fields: [okField({ size: "255); DROP TABLE t; --" })] }),
        ),
      ),
    ).toBe(false);
  });
});

describe("ddbDiagramIsValid applies the same identifier gate", () => {
  it("rejects a hostile table name in a .ddb import", () => {
    expect(
      ddbDiagramIsValid(base(okTable({ name: 'a" ; DROP TABLE t; --' }))),
    ).toBe(false);
  });
});
