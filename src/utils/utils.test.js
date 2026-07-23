import { describe, it, expect } from "vitest";
import { isKeyword, isFunction } from "./utils";

describe("isKeyword", () => {
  it("recognises SQL keywords case-insensitively", () => {
    expect(isKeyword("null")).toBe(true);
    expect(isKeyword("NULL")).toBe(true);
  });

  it("rejects non-keywords", () => {
    expect(isKeyword("not_a_keyword_xyz")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isKeyword(undefined)).toBe(false);
  });
});

describe("isFunction", () => {
  it("accepts a bare function call", () => {
    expect(isFunction("now()")).toBe(true);
  });

  it("rejects a payload that merely ends in a call", () => {
    expect(isFunction("now(); DROP TABLE t; --()")).toBe(false);
  });
});
