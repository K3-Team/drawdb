// Defense-in-depth at the trust boundary: these patterns constrain the diagram
// fields that flow into generated SQL, so hostile data is rejected before it
// reaches the exporters. They do NOT replace the export-side guards
// (quoteIdentifier, escapeQuotes, assertSafe*) -- both layers stay.
//
// Identifiers: exclude ASCII control characters (including newlines) and the
// delimiter/terminator metacharacters the exporters close identifiers with --
// backtick (MySQL), double quote (ANSI), right bracket (MSSQL) and semicolon.
// Everything else, including spaces and unicode letters, stays allowed:
// quoteIdentifier already quotes those safely, so the pattern's only job is to
// bar the handful of characters that could break out of a quoted identifier.
// Deliberately NOT `^[A-Za-z_]\w*$`, which would reject legitimate names.
const IDENTIFIER_PATTERN = '^[^\\u0000-\\u001F\\u007F"`\\];]*$';
const identifier = { type: "string", pattern: IDENTIFIER_PATTERN };
const identifierList = { type: "array", items: identifier };

// A column size: digits, commas and spaces (covers "255" and "10, 2"). Only
// constrains the string form; a numeric size is inherently safe.
const SIZE_PATTERN = "^[0-9, ]*$";

// The character shape assertSafeType accepts. The export guard additionally
// enforces balanced parentheses and no top-level comma; a JSON-schema pattern
// cannot express those, so this is the coarse half of a two-layer check.
const TYPE_PATTERN = "^[A-Za-z0-9_ ,()]*$";

// field.default and field.check carry no pattern on purpose: a CHECK is
// legitimately free-form SQL and a DEFAULT may be an arbitrary literal or
// function call, so any charset pattern would be both wrong and porous. Those
// two are guarded on the export side by assertNoStatementBreak /
// assertSafeDefault, which is the correct layer for expression grammar.
// Comments are likewise unconstrained here -- they legitimately contain
// backticks, quotes and semicolons -- and are neutralised at export.

export const tableSchema = {
  type: "object",
  properties: {
    id: { type: ["integer", "string"] },
    name: identifier,
    x: { type: "number" },
    y: { type: "number" },
    fields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: ["integer", "string"] },
          name: identifier,
          type: { type: "string", pattern: TYPE_PATTERN },
          default: { type: ["string", "number", "boolean"] },
          check: { type: "string" },
          primary: { type: "boolean" },
          unique: { type: "boolean" },
          notNull: { type: "boolean" },
          increment: { type: "boolean" },
          comment: { type: "string" },
          size: { type: ["string", "number"], pattern: SIZE_PATTERN },
          values: { type: "array", items: { type: "string" } },
        },
        required: [
          "id",
          "name",
          "type",
          "default",
          "check",
          "primary",
          "unique",
          "notNull",
          "increment",
          "comment",
        ],
      },
    },
    comment: { type: "string" },
    locked: { type: "boolean" },
    hidden: { type: "boolean" },
    collapsed: { type: "boolean" },
    indices: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: identifier,
          unique: { type: "boolean" },
          fields: identifierList,
        },
        required: ["name", "unique", "fields"],
      },
    },
    uniqueConstraints: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: identifier,
          fields: identifierList,
        },
        required: ["name", "fields"],
      },
    },
    color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
    inherits: identifierList,
  },
  required: ["id", "name", "x", "y", "fields", "comment", "indices", "color"],
};

export const areaSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    name: { type: "string" },
    x: { type: "number" },
    y: { type: "number" },
    width: { type: "number" },
    height: { type: "number" },
    locked: { type: "boolean" },
    color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
  },
  required: ["id", "name", "x", "y", "width", "height", "color"],
};

export const noteSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    x: { type: "number" },
    y: { type: "number" },
    title: { type: "string" },
    content: { type: "string" },
    color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
    height: { type: "number" },
    width: { type: "number" },
    locked: { type: "boolean" },
  },
  required: ["id", "x", "y", "title", "content", "color", "height"],
};

export const typeSchema = {
  type: "object",
  properties: {
    id: { type: ["string"] },
    name: identifier,
    fields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: ["string"] },
          name: identifier,
          type: { type: "string", pattern: TYPE_PATTERN },
          values: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["name", "type"],
      },
    },
    comment: { type: "string" },
  },
  required: ["name", "fields", "comment"],
};

export const enumSchema = {
  type: "object",
  properties: {
    name: identifier,
    values: {
      type: "array",
      items: { type: "string" },
    },
  },
};

export const customTypeEntrySchema = {
  type: "object",
  properties: {
    type: { type: "string", minLength: 1 },
    color: { type: "string" },
  },
  required: ["type", "color"],
};

export const jsonSchema = {
  type: "object",
  properties: {
    tables: {
      type: "array",
      items: { ...tableSchema },
    },
    relationships: {
      type: "array",
      items: {
        type: "object",
        properties: {
          startTableId: { type: ["integer", "string"] },
          startFieldId: { type: ["integer", "string"] },
          endTableId: { type: ["integer", "string"] },
          endFieldId: { type: ["integer", "string"] },
          name: identifier,
          cardinality: { type: "string" },
          updateConstraint: { type: "string" },
          deleteConstraint: { type: "string" },
          id: { type: ["integer", "string"] },
        },
        required: [
          "startTableId",
          "startFieldId",
          "endTableId",
          "endFieldId",
          "name",
          "cardinality",
          "updateConstraint",
          "deleteConstraint",
          "id",
        ],
      },
    },
    notes: {
      type: "array",
      items: { ...noteSchema },
    },
    subjectAreas: {
      type: "array",
      items: { ...areaSchema },
    },
    types: {
      type: "array",
      items: { ...typeSchema },
    },
    enums: {
      type: "array",
      items: { ...enumSchema },
    },
    title: { type: "string" },
    database: { type: "string" },
  },
  required: ["tables", "relationships", "notes", "subjectAreas"],
  additionalProperties: true,
};

export const ddbSchema = {
  type: "object",
  properties: {
    author: { type: "string" },
    project: { type: "string" },
    title: { type: "string" },
    date: { type: "string" },
    ...jsonSchema.properties,
  },
  required: jsonSchema.required,
};
