import { describe, it, expect } from "vitest";
import {
  dbmlString,
  dbmlSetting,
  dbmlColor,
  dbmlType,
  dbmlSize,
  dbmlBacktick,
  mermaidToken,
  mdInline,
  mdAnchor,
} from "./escape";

describe("DBML escaping (output compiles to SQL)", () => {
  it("dbmlString escapes quotes, backslashes, and newlines", () => {
    // a name that would close the '...' and inject a new setting
    const out = dbmlString("x'] ; DROP TABLE t; --");
    expect(out).toContain("\\'"); // the quote is escaped
    // no BARE (unescaped) quote survives to terminate the string early
    expect(out.replace(/\\'/g, "")).not.toContain("'");
    expect(dbmlString("a\\b")).toBe("a\\\\b");
    expect(dbmlString("a\nb")).toBe("a b");
  });

  it("dbmlSetting keeps plain tokens bare but quotes anything else", () => {
    expect(dbmlSetting("cascade")).toBe("cascade");
    expect(dbmlSetting("no action")).toBe("no action");
    // a hostile constraint is wrapped in a string, so its ] is inert content
    // rather than a block terminator
    expect(dbmlSetting("cascade] injected [x: y")).toMatch(/^'.*'$/);
  });

  it("dbmlColor accepts hex only, rejects breakouts", () => {
    expect(dbmlColor("#175e7a")).toBe("#175e7a");
    expect(dbmlColor("#fff")).toBe("#fff");
    expect(dbmlColor("red] { evil")).toBeNull();
    expect(dbmlColor("javascript:alert(1)")).toBeNull();
  });

  it("dbmlType strips to a safe token (types compile to SQL)", () => {
    expect(dbmlType("VARCHAR")).toBe("varchar");
    expect(dbmlType("int; DROP TABLE t")).toBe("int drop table t");
    expect(dbmlType("")).toBe("varchar");
  });

  it("dbmlSize allows digits/commas only", () => {
    expect(dbmlSize("255")).toBe("255");
    expect(dbmlSize("10, 2")).toBe("10, 2");
    expect(dbmlSize("255) injected (")).toBeNull();
  });

  it("dbmlBacktick strips backticks so an expr can't break out", () => {
    expect(dbmlBacktick("now()")).toBe("`now()`");
    expect(dbmlBacktick("x`) ; DROP; `(")).toBe("`x) ; DROP; (`");
    expect(dbmlBacktick("x`) ; DROP; `(")).not.toMatch(/`.*`.*`/);
  });
});

describe("Mermaid escaping (rendered in the viewer's tools)", () => {
  it("reduces identifiers to safe tokens", () => {
    expect(mermaidToken("users")).toBe("users");
    // newline/brace/quote break-out becomes underscores
    expect(mermaidToken('a"}\n b {')).toBe("a____b__");
    expect(mermaidToken("")).toBe("unnamed");
  });
});

describe("Markdown escaping (rendered docs)", () => {
  it("mdInline neutralises table pipes, HTML, newlines, and backticks", () => {
    expect(mdInline("a|b")).toBe("a\\|b");
    expect(mdInline("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
    expect(mdInline("a\nb")).toBe("a b");
    expect(mdInline("`code`")).toBe("\\`code\\`");
  });

  it("mdAnchor produces a safe slug", () => {
    expect(mdAnchor("My Table")).toBe("my-table");
    expect(mdAnchor("a](evil)")).toBe("a-evil-");
  });
});
