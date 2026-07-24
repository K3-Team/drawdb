import assert from "node:assert/strict";
import test from "node:test";
import { isDiagramDocument } from "./validateDocument.js";

// The structural gate every untrusted (shared / imported / AI-authored)
// document passes before being persisted or rebroadcast. Property: it must
// NEVER throw and must return a strict boolean for ANY input, accepting only
// the diagram shape and rejecting everything else.

const arraysOr = (keys) => Object.fromEntries(keys.map((k) => [k, []]));

test("never throws and returns a boolean for hostile inputs", () => {
  const hostile = [
    null, undefined, 0, 1, "", "x", true, false, NaN, Infinity, [],
    {}, [1, 2, 3], () => {}, Symbol("s"), 42n,
    { tables: "no" }, { tables: [] }, { tables: [], notes: [] },
    { tables: {}, notes: {}, references: {}, areas: {} },
    { tables: [], notes: [], references: [] }, // missing areas
    Object.create(null),
    { __proto__: { tables: [] } }, // prototype-only, own missing
  ];
  hostile.forEach((input, i) => {
    const out = isDiagramDocument(input);
    assert.equal(typeof out, "boolean", `expected boolean for hostile[${i}]`);
  });
});

test("accepts both wire-form and schema-form key aliases", () => {
  // wire form: references / areas
  assert.equal(
    isDiagramDocument({ tables: [], notes: [], references: [], areas: [] }),
    true,
  );
  // schema form: relationships / subjectAreas
  assert.equal(
    isDiagramDocument({ tables: [], notes: [], relationships: [], subjectAreas: [] }),
    true,
  );
});

test("rejects a document missing any required array", () => {
  const required = ["tables", "notes", "references", "areas"];
  for (const omit of required) {
    const doc = arraysOr(required.filter((k) => k !== omit));
    assert.equal(isDiagramDocument(doc), false, `missing ${omit} must be rejected`);
  }
});

test("rejects when a required key is present but not an array", () => {
  for (const bad of ["x", 1, {}, null, true]) {
    assert.equal(
      isDiagramDocument({ tables: bad, notes: [], references: [], areas: [] }),
      false,
    );
  }
});

test("fuzz: random objects never throw", () => {
  let seed = 0x9e3779b9;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const values = [[], {}, "", 0, null, undefined, true, [1], { a: 1 }];
  for (let i = 0; i < 2000; i++) {
    const doc = {};
    for (const k of ["tables", "notes", "references", "areas", "relationships", "subjectAreas", "junk"]) {
      if (rnd() > 0.5) doc[k] = values[Math.floor(rnd() * values.length)];
    }
    assert.equal(typeof isDiagramDocument(doc), "boolean");
  }
});
