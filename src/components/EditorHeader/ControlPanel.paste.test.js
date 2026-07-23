import { describe, it, expect } from "vitest";
import { Validator } from "jsonschema";
import { noteSchema, tableSchema, areaSchema } from "../../data/schemas";

// Regression guard for the paste handler in ControlPanel.jsx: a pasted object
// that is neither a table nor an area must NOT be accepted as a note. The bug
// was calling `v.validate(obj, noteSchema)` (always-truthy result object)
// instead of `.valid`.
describe("paste validation predicate", () => {
  const v = new Validator();

  it("rejects an arbitrary object as a note", () => {
    const obj = { nonsense: true };
    expect(v.validate(obj, tableSchema).valid).toBe(false);
    expect(v.validate(obj, areaSchema).valid).toBe(false);
    expect(v.validate(obj, noteSchema).valid).toBe(false);
  });

  it("accepts a well-formed note", () => {
    const note = {
      id: 0,
      x: 10,
      y: 20,
      title: "n",
      content: "c",
      color: "#ffffff",
      height: 100,
    };
    expect(v.validate(note, noteSchema).valid).toBe(true);
  });

  it("the raw ValidatorResult is truthy even when invalid (why .valid is required)", () => {
    expect(Boolean(v.validate({ nonsense: true }, noteSchema))).toBe(true);
  });
});
