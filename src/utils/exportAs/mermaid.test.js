import { describe, it, expect } from "vitest";
import { jsonToMermaid } from "./mermaid";
import { fr } from "../../i18n/locales/fr";

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

  it("folds a legacy translated label without participation, in any locale", () => {
    const f = fixture();
    f.relationships = [
      {
        id: "r1",
        name: "fk_posts_author",
        startTableId: "t2",
        startFieldId: "f4",
        endTableId: "t1",
        endFieldId: "f1",
        cardinality: fr.translation.many_to_one,
        updateConstraint: "No action",
        deleteConstraint: "No action",
      },
    ];
    expect(jsonToMermaid(f)).toContain("}o--||");
  });

  it("marks the parent side optional when any column of a composite FK is nullable", () => {
    const f = fixture();
    f.tables[1].fields.push(
      field("f5", "tenant_id", "INT", { notNull: true }),
    );
    f.relationships = [
      {
        id: "r1",
        name: "fk_posts_author",
        startTableId: "t2",
        startFieldId: "f5",
        endTableId: "t1",
        endFieldId: "f1",
        fields: [
          { startFieldId: "f5", endFieldId: "f1" },
          { startFieldId: "f4", endFieldId: "f1" },
        ],
        cardinality: "many_to_one",
        updateConstraint: "No action",
        deleteConstraint: "No action",
        participation: { end: "mandatory" },
      },
    ];
    expect(jsonToMermaid(f)).toContain("}|--o|");
  });
});
