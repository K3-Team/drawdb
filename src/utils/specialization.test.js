import { describe, it, expect } from "vitest";
import {
  isSubtype,
  siblingsOf,
  subtypeName,
  childMin,
  badgeTexts,
} from "./specialization";

const field = (id, extra = {}) => ({
  id,
  name: `f${id}`,
  type: "INT",
  default: "",
  check: "",
  primary: false,
  unique: false,
  notNull: false,
  increment: false,
  comment: "",
  ...extra,
});

const tables = [
  { id: "user", name: "user", fields: [field("u_id", { primary: true, notNull: true })] },
  { id: "customer", name: "customer", fields: [field("c_id", { primary: true, notNull: true })] },
  { id: "seller", name: "seller", fields: [field("s_id", { primary: true, notNull: true })] },
  {
    id: "order",
    name: "order",
    fields: [field("o_id", { primary: true }), field("o_cust", { notNull: true }), field("o_ship")],
  },
];

const rel = (over = {}) => ({
  id: "r",
  name: "fk",
  startTableId: "order",
  startFieldId: "o_cust",
  endTableId: "customer",
  endFieldId: "c_id",
  cardinality: "many_to_one",
  updateConstraint: "No action",
  deleteConstraint: "No action",
  ...over,
});

const sub = (id, startTableId, startFieldId, group = "role", extra = {}) =>
  rel({
    id,
    kind: "subtype",
    startTableId,
    startFieldId,
    endTableId: "user",
    endFieldId: "u_id",
    cardinality: "one_to_one",
    subtype: { group, disjoint: false, total: true, ...extra },
  });

describe("isSubtype", () => {
  it("is false for absent kind and for fk", () => {
    expect(isSubtype(rel())).toBe(false);
    expect(isSubtype(rel({ kind: "fk" }))).toBe(false);
  });
  it("is true for kind subtype", () => {
    expect(isSubtype(sub("a", "customer", "c_id"))).toBe(true);
  });
});

describe("siblingsOf", () => {
  const a = sub("a", "customer", "c_id");
  const b = sub("b", "seller", "s_id");
  const other = sub("c", "seller", "s_id", "other-group");
  it("returns links sharing supertype and group, including self", () => {
    expect(siblingsOf([a, b, other, rel()], a).map((r) => r.id)).toEqual(["a", "b"]);
  });
  it("returns [] for an fk link", () => {
    expect(siblingsOf([a, b], rel())).toEqual([]);
  });
});

describe("subtypeName", () => {
  it("builds is_a_<sub>_<super>", () => {
    expect(subtypeName("customer", "user")).toBe("is_a_customer_user");
  });
});

describe("childMin", () => {
  it("is 1 when the FK field is NOT NULL, else 0", () => {
    expect(childMin(rel(), tables)).toBe(1);
    expect(childMin(rel({ startFieldId: "o_ship" }), tables)).toBe(0);
  });
  it("is 1 when the field cannot be found", () => {
    expect(childMin(rel({ startFieldId: "missing" }), tables)).toBe(1);
  });
});

describe("badgeTexts", () => {
  it("keeps legacy 1 / n when participation is absent", () => {
    expect(badgeTexts(rel(), tables)).toEqual({ start: "n", end: "1" });
    expect(badgeTexts(rel({ cardinality: "one_to_one" }), tables)).toEqual({ start: "1", end: "1" });
    expect(badgeTexts(rel({ cardinality: "one_to_many" }), tables)).toEqual({ start: "1", end: "n" });
  });
  it("honours manyLabel", () => {
    expect(badgeTexts(rel({ manyLabel: "*" }), tables)).toEqual({ start: "*", end: "1" });
  });
  it("shows min..max when participation is set (look-across)", () => {
    expect(badgeTexts(rel({ participation: { end: "optional" } }), tables)).toEqual({
      start: "0..n",
      end: "1..1",
    });
    expect(
      badgeTexts(rel({ startFieldId: "o_ship", participation: { end: "mandatory" } }), tables),
    ).toEqual({ start: "1..n", end: "0..1" });
    expect(
      badgeTexts(rel({ cardinality: "one_to_one", participation: { end: "optional" } }), tables),
    ).toEqual({ start: "0..1", end: "1..1" });
    expect(
      badgeTexts(rel({ cardinality: "one_to_many", participation: { end: "mandatory" }, manyLabel: "m" }), tables),
    ).toEqual({ start: "1..1", end: "1..m" });
  });
  it("returns the EER glyphs for a subtype link", () => {
    expect(badgeTexts(sub("a", "customer", "c_id"), tables)).toEqual({ start: "⊂", end: "o" });
    expect(badgeTexts(sub("a", "customer", "c_id", "role", { disjoint: true }), tables)).toEqual({
      start: "⊂",
      end: "d",
    });
  });
  it("tolerates legacy translated cardinality strings", () => {
    expect(badgeTexts(rel({ cardinality: "Many to one" }), tables)).toEqual({ start: "n", end: "1" });
    expect(badgeTexts(rel({ cardinality: "One to many" }), tables)).toEqual({ start: "1", end: "n" });
  });
});
