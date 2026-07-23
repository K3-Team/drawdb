import { describe, it, expect } from "vitest";
import { isKeyword } from "./utils";

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
