import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/* global process */

// Editors and tooling have pasted raw control bytes (NUL, 0x1F, etc) into
// source instead of backslash-escaped forms; git then treats the file as
// binary. Fail fast.
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name === "vendor" || name === "dist") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|jsx|mjs|css|json)$/.test(name)) out.push(p);
  }
  return out;
}

describe("source files contain no raw control bytes", () => {
  const root = join(process.cwd());
  const files = ["src", "mcp", "server", "e2e"].flatMap((d) => walk(join(root, d)));
  it("scans a non-trivial number of files", () => {
    expect(files.length).toBeGreaterThan(50);
  });
  for (const f of files) {
    it(f.replace(root, ""), () => {
      const buf = readFileSync(f);
      const bad = [...buf].filter((c) => (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0x7f);
      expect(bad.length).toBe(0);
    });
  }
});
