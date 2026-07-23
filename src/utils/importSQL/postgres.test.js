import { describe, it, expect } from "vitest";
import { escapeRegExp } from "./postgres";

describe("escapeRegExp", () => {
  it("escapes regex metacharacters", () => {
    expect(escapeRegExp("a.b*c")).toBe("a\\.b\\*c");
  });

  it("leaves an ordinary identifier unchanged", () => {
    expect(escapeRegExp("my_enum")).toBe("my_enum");
  });
});
