import { describe, it, expect } from "vitest";
import { Validator } from "jsonschema";
import { ddbSchema, jsonSchema, noteSchema } from "./schemas";
import { template1 } from "../templates/template1";
import { template2 } from "../templates/template2";
import { template3 } from "../templates/template3";
import { template4 } from "../templates/template4";
import { template5 } from "../templates/template5";
import { template6 } from "../templates/template6";
import { templateSeeds } from "./seeds";

const v = new Validator();

describe("ddbSchema", () => {
  it("rejects an empty object", () => {
    expect(v.validate({}, ddbSchema).valid).toBe(false);
  });

  it("accepts a minimal well-formed diagram", () => {
    const diagram = {
      tables: [],
      relationships: [],
      notes: [],
      subjectAreas: [],
    };
    expect(v.validate(diagram, ddbSchema).valid).toBe(true);
  });
});

describe("jsonSchema", () => {
  it("still rejects an empty object", () => {
    expect(v.validate({}, jsonSchema).valid).toBe(false);
  });
});

describe("noteSchema", () => {
  it("rejects an arbitrary object", () => {
    expect(v.validate({ nonsense: true }, noteSchema).valid).toBe(false);
  });
});

const table = (over = {}) => ({
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
const field = (over = {}) => ({
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
const diagramWith = (t) => ({
  tables: [t],
  relationships: [],
  notes: [],
  subjectAreas: [],
});

describe("schema hardening rejects SQL metacharacters at the trust boundary", () => {
  const hostileNames = ["a`b", 'a"b', "a]b", "a;b", "a\nb", "a\tb"];

  for (const name of hostileNames) {
    it(`rejects table name ${JSON.stringify(name)}`, () => {
      expect(v.validate(diagramWith(table({ name })), jsonSchema).valid).toBe(
        false,
      );
    });

    it(`rejects field name ${JSON.stringify(name)}`, () => {
      expect(
        v.validate(
          diagramWith(table({ fields: [field({ name })] })),
          jsonSchema,
        ).valid,
      ).toBe(false);
    });
  }

  it("rejects a type name carrying a statement break", () => {
    const d = diagramWith(table({ fields: [field({ type: "INT); DROP" })] }));
    expect(v.validate(d, jsonSchema).valid).toBe(false);
  });

  it("rejects a size that is not digits/commas/spaces", () => {
    const d = diagramWith(table({ fields: [field({ size: "255); DROP" })] }));
    expect(v.validate(d, jsonSchema).valid).toBe(false);
  });

  it("accepts legitimate names with spaces and unicode", () => {
    for (const name of ["My Table", "café", "订单", "order-items", "a.b"]) {
      expect(v.validate(diagramWith(table({ name })), jsonSchema).valid).toBe(
        true,
      );
    }
  });

  it("accepts a NUMBER(38,0) precision size and multi-word type", () => {
    const d = diagramWith(
      table({ fields: [field({ type: "DOUBLE PRECISION", size: "38, 0" })] }),
    );
    expect(v.validate(d, jsonSchema).valid).toBe(true);
  });

  it("does not constrain free-form check or comment", () => {
    const d = diagramWith(
      table({
        comment: "uses `id`; see notes -- ok",
        fields: [field({ check: "a > 0 AND b < 10", comment: "x; y `z`" })],
      }),
    );
    expect(v.validate(d, jsonSchema).valid).toBe(true);
  });
});

describe("bundled diagrams still pass the hardened schema", () => {
  const norm = (d) => ({
    tables: d.tables ?? [],
    relationships: d.relationships ?? [],
    notes: d.notes ?? [],
    subjectAreas: d.subjectAreas ?? [],
    types: d.types ?? [],
    enums: d.enums ?? [],
  });
  const bundled = [
    ["template1", template1],
    ["template2", template2],
    ["template3", template3],
    ["template4", template4],
    ["template5", template5],
    ["template6", template6],
    ...templateSeeds.map((s, i) => [`seed${i}`, s]),
  ];
  for (const [label, d] of bundled) {
    it(`${label} validates`, () => {
      expect(v.validate(norm(d), jsonSchema).valid).toBe(true);
    });
  }
});
