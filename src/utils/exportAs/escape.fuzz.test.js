import { describe, it, expect } from "vitest";
import {
  dbmlString,
  dbmlSetting,
  dbmlType,
  dbmlBacktick,
  dbmlSize,
  dbmlColor,
  mermaidToken,
  mdInline,
  mdAnchor,
} from "./escape";

// Property fuzz for the export-target escapers. A shared/imported diagram is
// attacker-controlled; each escaper must NEVER throw and its output must not be
// able to break out of its grammar, for any input. Deterministic LCG so a
// failure is reproducible rather than flaky.

const CHARS = ['"', "'", "`", "\\", "\n", "\r", "|", "<", ">", ";", "]", "[", "#", "(", ")", " ", "a", "1", "_", "-", "\t", "{", "}"];

function* fuzz(n) {
  let seed = 0x2545f491;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < n; i++) {
    const len = 1 + Math.floor(rnd() * 12);
    let s = "";
    for (let j = 0; j < len; j++) s += CHARS[Math.floor(rnd() * CHARS.length)];
    yield s;
  }
}

const inputs = [...fuzz(3000), "", "'; DROP", "a`b`c", "x\ny", "|c|", "<script>"];

describe("escaper invariants hold for all inputs", () => {
  it("dbmlString: no unescaped quote, no raw newline", () => {
    for (const s of inputs) {
      const out = dbmlString(s);
      expect(/(?<!\\)'/.test(out), s).toBe(false);
      expect(/[\r\n]/.test(out), s).toBe(false);
    }
  });

  it("dbmlBacktick: no backtick inside the delimiters", () => {
    for (const s of inputs) {
      const out = dbmlBacktick(s);
      expect(out.startsWith("`") && out.endsWith("`")).toBe(true);
      expect(out.slice(1, -1).includes("`"), s).toBe(false);
    }
  });

  it("dbmlSetting: bare token or a safe quoted string", () => {
    for (const s of inputs) {
      const out = dbmlSetting(s);
      const bare = /^[A-Za-z0-9_ ]+$/.test(out);
      const quoted = out.startsWith("'") && out.endsWith("'") && !/(?<!\\)'/.test(out.slice(1, -1));
      expect(bare || quoted, `${s} -> ${out}`).toBe(true);
    }
  });

  it("dbmlType: safe charset only, never empty", () => {
    for (const s of inputs) expect(/^[a-z0-9_ ]+$/.test(dbmlType(s)), s).toBe(true);
  });

  it("dbmlSize / dbmlColor: matching pattern or null", () => {
    for (const s of inputs) {
      const size = dbmlSize(s);
      expect(size === null || /^[0-9, ]+$/.test(size), s).toBe(true);
      const color = dbmlColor(s);
      expect(color === null || /^#[0-9a-fA-F]{3,8}$/.test(color), s).toBe(true);
    }
  });

  it("mermaidToken: alphanumeric/underscore only", () => {
    for (const s of inputs) expect(/^[A-Za-z0-9_]+$/.test(mermaidToken(s)), s).toBe(true);
  });

  it("mdInline: no raw pipe, angle bracket, newline, or backtick break-out", () => {
    for (const s of inputs) {
      const out = mdInline(s);
      expect(/[\r\n<>]/.test(out), s).toBe(false);
      expect(/(?<!\\)\|/.test(out), s).toBe(false);
      expect(/(?<!\\)`/.test(out), s).toBe(false);
    }
  });

  it("mdAnchor: slug charset only", () => {
    for (const s of inputs) expect(/^[a-z0-9_-]*$/.test(mdAnchor(s)), s).toBe(true);
  });
});
