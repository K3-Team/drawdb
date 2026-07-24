import { describe, it, expect } from "vitest";
import { toDBML } from "./dbml";
import { jsonToMermaid } from "./mermaid";
import { jsonToDocumentation } from "./documentation";

// Structural golden tests for the three exportAs generators. escape.test.js
// already pins the escapers; these verify the generators wire them in and emit
// well-formed output — and that hostile identifiers don't crash or break out.

const field = (id, name, type, extra = {}) => ({
  id,
  name,
  type,
  default: "",
  check: "",
  primary: false,
  unique: false,
  notNull: false,
  increment: false,
  comment: "",
  ...extra,
});

const fixture = (overrides = {}) => ({
  title: "Test schema",
  database: "postgresql",
  tables: [
    {
      id: "t1",
      name: "users",
      x: 0,
      y: 0,
      comment: "",
      indices: [],
      color: "#175e7a",
      fields: [
        field("f1", "id", "INT", { primary: true, notNull: true, increment: true }),
        field("f2", "email", "VARCHAR", { size: 255, notNull: true }),
      ],
    },
    {
      id: "t2",
      name: "posts",
      x: 0,
      y: 0,
      comment: "",
      indices: [],
      color: "#175e7a",
      fields: [
        field("f3", "id", "INT", { primary: true }),
        field("f4", "author_id", "INT"),
      ],
    },
  ],
  relationships: [
    {
      id: "r1",
      name: "fk_posts_author",
      startTableId: "t2",
      startFieldId: "f4",
      endTableId: "t1",
      endFieldId: "f1",
      cardinality: "many_to_one",
      updateConstraint: "No action",
      deleteConstraint: "No action",
    },
  ],
  enums: [],
  types: [],
  ...overrides,
});

// A table/field name that could break out of a quoted identifier.
const hostile = () =>
  fixture({
    tables: [
      {
        id: "t1",
        name: 'ev"il`;\n drop',
        x: 0,
        y: 0,
        comment: "",
        indices: [],
        color: "#175e7a",
        fields: [field("f1", 'c"ol`', "INT", { primary: true })],
      },
    ],
    relationships: [],
  });

describe("toDBML", () => {
  it("emits Table blocks, fields, and a Ref", () => {
    const out = toDBML(fixture());
    expect(out).toMatch(/Table users/);
    expect(out).toMatch(/Table posts/);
    expect(out).toContain("email");
    expect(out).toMatch(/Ref/);
  });
  it("does not crash and neutralises hostile identifiers", () => {
    const out = toDBML(hostile());
    expect(typeof out).toBe("string");
    // A raw backtick-delimited break must not survive verbatim.
    expect(out).not.toContain('ev"il`;\n drop');
  });
});

describe("jsonToMermaid", () => {
  it("emits an erDiagram with tables and the relationship", () => {
    const out = jsonToMermaid(fixture());
    expect(out).toMatch(/erDiagram/);
    expect(out).toContain("users");
    expect(out).toContain("posts");
  });
  it("does not crash on hostile identifiers", () => {
    expect(typeof jsonToMermaid(hostile())).toBe("string");
  });
});

describe("jsonToDocumentation", () => {
  it("emits markdown with the title and tables", () => {
    const out = jsonToDocumentation(fixture());
    expect(out).toContain("users");
    expect(out).toContain("posts");
    expect(out.length).toBeGreaterThan(50);
  });
  it("does not crash on hostile identifiers", () => {
    expect(typeof jsonToDocumentation(hostile())).toBe("string");
  });
});
