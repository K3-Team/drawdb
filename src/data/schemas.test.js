import { describe, it, expect } from "vitest";
import { Validator } from "jsonschema";
import { ddbSchema, jsonSchema, noteSchema } from "./schemas";

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
