import { describe, it, expect } from "vitest";
import { fromDBML } from "./dbml";

// fromDBML (client) is mirrored by the MCP service's applyDbml; both had the
// client side untested. Parse DBML -> assert tables/fields/relationships/enums.

const SAMPLE = `
Table users {
  id integer [pk, increment]
  email varchar [unique, not null]
  status status_enum
}

Table posts {
  id integer [pk]
  author_id integer
}

Ref: posts.author_id > users.id

Enum status_enum {
  active
  banned
}
`;

describe("fromDBML", () => {
  it("imports tables, fields, relationships, and enums", () => {
    const { tables, relationships, enums } = fromDBML(SAMPLE);
    expect(tables.length).toBe(2);
    const users = tables.find((t) => t.name === "users");
    expect(users).toBeTruthy();
    const id = users.fields.find((f) => f.name === "id");
    expect(id.primary).toBe(true);
    expect(id.increment).toBe(true);
    // Client quirk: fromDBML derives `unique` from pk, not the [unique] attr.
    expect(id.unique).toBe(true);
    expect(users.fields.find((f) => f.name === "email").notNull).toBe(true);

    expect(relationships.length).toBe(1);
    const rel = relationships[0];
    expect(tables.some((t) => t.id === rel.startTableId)).toBe(true);
    expect(tables.some((t) => t.id === rel.endTableId)).toBe(true);

    expect(enums.length).toBe(1);
    expect(enums[0].values).toEqual(["active", "banned"]);
  });

  it("assigns positions (arrangeTables) rather than stacking at the origin", () => {
    const { tables } = fromDBML(SAMPLE);
    const distinct = new Set(tables.map((t) => `${t.x},${t.y}`));
    expect(distinct.size).toBe(tables.length);
  });

  it("rejects a ref to a missing table (parser-level validation)", () => {
    expect(() =>
      fromDBML(`
        Table a { id integer [pk] }
        Ref: a.id > ghost.id
      `),
    ).toThrow();
  });
});
