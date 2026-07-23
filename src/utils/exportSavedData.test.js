import { describe, it, expect } from "vitest";
import { safeEntryName } from "./exportSavedData";

describe("safeEntryName", () => {
  it("passes ordinary names through unchanged", () => {
    expect(safeEntryName("my diagram")).toBe("my diagram");
  });

  it("strips path separators", () => {
    expect(safeEntryName("a/b\\c")).toBe("a_b_c");
  });

  it("neutralises directory traversal", () => {
    const out = safeEntryName("../../../../.ssh/authorized_keys");
    expect(out).not.toContain("..");
    expect(out).not.toContain("/");
    expect(out).not.toContain("\\");
  });

  it("falls back to a default for empty or dot-only names", () => {
    expect(safeEntryName("")).toBe("diagram");
    expect(safeEntryName("..")).toBe("diagram");
    expect(safeEntryName("...")).toBe("diagram");
    expect(safeEntryName(null)).toBe("diagram");
    expect(safeEntryName(undefined)).toBe("diagram");
  });

  it("coerces non-string input", () => {
    expect(safeEntryName(123)).toBe("123");
  });
});
