import { describe, it, expect } from "vitest";
import { jsonToMermaid } from "./mermaid";

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
      fields: [field("f1", "id", "INT", { primary: true, notNull: true, increment: true })],
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
        // Nullable FK field (no notNull, no primary): childMin resolves to 0.
        field("f4", "author_id", "INT"),
      ],
    },
  ],
  relationships: [],
  enums: [],
  types: [],
  ...overrides,
});

describe("jsonToMermaid", () => {
  it("folds a legacy translated cardinality label when computing participation glyphs", () => {
    const out = jsonToMermaid(
      fixture({
        relationships: [
          {
            id: "r1",
            name: "fk_posts_author",
            startTableId: "t2",
            startFieldId: "f4",
            endTableId: "t1",
            endFieldId: "f1",
            cardinality: "Many to one",
            updateConstraint: "No action",
            deleteConstraint: "No action",
            participation: { end: "optional" },
          },
        ],
      }),
    );
    expect(out).toContain("}o--o|");
  });
});
