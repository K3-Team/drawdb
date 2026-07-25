import { describe, it, expect } from "vitest";
import { isRtl } from "./rtl";

describe("isRtl", () => {
  it("flags the shipped RTL (Arabic-script) locales, including ug and sd", () => {
    for (const l of ["ar", "he", "fa", "ur", "ug", "sd"]) {
      expect(isRtl(l)).toBe(true);
    }
  });

  it("does not flag LTR locales", () => {
    for (const l of ["en", "de", "zh", "ps"]) {
      expect(isRtl(l)).toBe(false);
    }
  });
});
