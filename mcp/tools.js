import { z } from "zod";
import * as M from "./mutators/index.js";

// Registers the fine-grained MCP tool surface on a McpServer, bound to one
// session. Mutating tools run their pure transform through
// session.requireActive().mutate(...) — which persists it as a snapshot with
// optimistic-concurrency retry and broadcasts to every connected browser.
// Read tools operate on the session's cached document. Errors from mutators
// (not-found, invalid input) are returned as MCP tool errors, not thrown.

const text = (value) => ({
  content: [
    {
      type: "text",
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});

const fieldShape = z.object({
  name: z.string(),
  type: z.string(),
  size: z.union([z.string(), z.number()]).optional(),
  primary: z.boolean().optional(),
  unique: z.boolean().optional(),
  notNull: z.boolean().optional(),
  increment: z.boolean().optional(),
  default: z.string().optional(),
  check: z.string().optional(),
  comment: z.string().optional(),
});

export function registerTools(server, session) {
  const mutate = (fn) => session.requireActive().mutate(fn);
  const readDoc = () => session.requireActive().getState().document;

  const tool = (name, description, inputSchema, handler) =>
    server.registerTool(name, { description, inputSchema }, async (args) => {
      try {
        return text(await handler(args ?? {}));
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    });

  // ---- diagram lifecycle --------------------------------------------------
  tool("list_diagrams", "List all diagrams on the server.", {}, () =>
    session.listDiagrams(),
  );
  tool(
    "create_diagram",
    "Create a new empty diagram and open it for editing.",
    { name: z.string(), database: z.string().optional() },
    (a) => session.createDiagram(a),
  );
  tool(
    "open_diagram",
    "Open an existing diagram by id; subsequent edit tools act on it.",
    { diagramId: z.string() },
    (a) => session.openDiagram(a.diagramId),
  );
  tool(
    "get_diagram",
    "Return the full document (tables, relationships, notes, areas, ...) of the open diagram.",
    {},
    () => M.getDiagram(readDoc()),
  );
  tool(
    "get_table",
    "Get one table from the open diagram by id or name.",
    { tableId: z.string().optional(), tableName: z.string().optional() },
    (a) => M.getTable(readDoc(), a),
  );

  // ---- tables & fields ----------------------------------------------------
  tool(
    "add_table",
    "Add a table. Without fields, a default primary-key id field is created.",
    {
      name: z.string(),
      x: z.number().optional(),
      y: z.number().optional(),
      fields: z.array(fieldShape).optional(),
      color: z.string().optional(),
      comment: z.string().optional(),
    },
    (a) => mutate((d) => M.addTable(d, a)),
  );
  tool(
    "update_table",
    "Update a table's name, position, color, comment, or fields.",
    {
      tableId: z.string(),
      updates: z.object({
        name: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        comment: z.string().optional(),
        color: z.string().optional(),
        fields: z.array(fieldShape).optional(),
      }),
    },
    (a) => mutate((d) => M.updateTable(d, a.tableId, a.updates)),
  );
  tool(
    "delete_table",
    "Delete a table and any relationships referencing it.",
    { tableId: z.string() },
    (a) => mutate((d) => M.deleteTable(d, a.tableId)),
  );
  tool(
    "add_field",
    "Add a field to a table.",
    { tableId: z.string(), field: fieldShape },
    (a) => mutate((d) => M.addField(d, a.tableId, a.field)),
  );
  tool(
    "update_field",
    "Update a field on a table.",
    {
      tableId: z.string(),
      fieldId: z.string(),
      updates: fieldShape.partial(),
    },
    (a) => mutate((d) => M.updateField(d, a.tableId, a.fieldId, a.updates)),
  );
  tool(
    "delete_field",
    "Delete a field from a table.",
    { tableId: z.string(), fieldId: z.string() },
    (a) => mutate((d) => M.deleteField(d, a.tableId, a.fieldId)),
  );

  // ---- relationships ------------------------------------------------------
  tool(
    "add_relationship",
    "Add a foreign-key relationship between two existing table fields.",
    {
      startTableId: z.string(),
      startFieldId: z.string(),
      endTableId: z.string(),
      endFieldId: z.string(),
      name: z.string().optional(),
      cardinality: z
        .enum(["one_to_one", "one_to_many", "many_to_one"])
        .optional(),
      updateConstraint: z.string().optional(),
      deleteConstraint: z.string().optional(),
    },
    (a) => mutate((d) => M.addRelationship(d, a)),
  );
  tool(
    "update_relationship",
    "Update a relationship's name, cardinality, or constraints.",
    {
      relationshipId: z.string(),
      updates: z.object({
        name: z.string().optional(),
        cardinality: z
          .enum(["one_to_one", "one_to_many", "many_to_one"])
          .optional(),
        updateConstraint: z.string().optional(),
        deleteConstraint: z.string().optional(),
      }),
    },
    (a) => mutate((d) => M.updateRelationship(d, a.relationshipId, a.updates)),
  );
  tool(
    "delete_relationship",
    "Delete a relationship.",
    { relationshipId: z.string() },
    (a) => mutate((d) => M.deleteRelationship(d, a.relationshipId)),
  );

  // ---- areas --------------------------------------------------------------
  tool(
    "add_area",
    "Add a subject area (a labelled region grouping tables).",
    {
      name: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      color: z.string().optional(),
    },
    (a) => mutate((d) => M.addArea(d, a)),
  );
  tool(
    "update_area",
    "Update a subject area.",
    {
      areaId: z.number(),
      updates: z.object({
        name: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        color: z.string().optional(),
      }),
    },
    (a) => mutate((d) => M.updateArea(d, a.areaId, a.updates)),
  );
  tool(
    "delete_area",
    "Delete a subject area.",
    { areaId: z.number() },
    (a) => mutate((d) => M.deleteArea(d, a.areaId)),
  );

  // ---- notes --------------------------------------------------------------
  tool(
    "add_note",
    "Add a sticky note.",
    {
      title: z.string().optional(),
      content: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      color: z.string().optional(),
    },
    (a) => mutate((d) => M.addNote(d, a)),
  );
  tool(
    "update_note",
    "Update a note.",
    {
      noteId: z.number(),
      updates: z.object({
        title: z.string().optional(),
        content: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        color: z.string().optional(),
      }),
    },
    (a) => mutate((d) => M.updateNote(d, a.noteId, a.updates)),
  );
  tool(
    "delete_note",
    "Delete a note.",
    { noteId: z.number() },
    (a) => mutate((d) => M.deleteNote(d, a.noteId)),
  );

  // ---- enums & types (database-dependent) ---------------------------------
  tool(
    "add_enum",
    "Add an enum (databases that support enums, e.g. PostgreSQL).",
    { name: z.string(), values: z.array(z.string()).optional() },
    (a) => mutate((d) => M.addEnum(d, a)),
  );
  tool(
    "update_enum",
    "Update an enum by name.",
    {
      name: z.string(),
      updates: z.object({
        name: z.string().optional(),
        values: z.array(z.string()).optional(),
      }),
    },
    (a) => mutate((d) => M.updateEnum(d, a.name, a.updates)),
  );
  tool(
    "delete_enum",
    "Delete an enum by name.",
    { name: z.string() },
    (a) => mutate((d) => M.deleteEnum(d, a.name)),
  );
  tool(
    "add_type",
    "Add a composite type (databases that support types, e.g. PostgreSQL).",
    {
      name: z.string(),
      fields: z
        .array(z.object({ name: z.string(), type: z.string() }))
        .optional(),
      comment: z.string().optional(),
    },
    (a) => mutate((d) => M.addType(d, a)),
  );
  tool(
    "update_type",
    "Update a composite type by name.",
    {
      name: z.string(),
      updates: z.object({
        name: z.string().optional(),
        comment: z.string().optional(),
        fields: z
          .array(z.object({ name: z.string(), type: z.string() }))
          .optional(),
      }),
    },
    (a) => mutate((d) => M.updateType(d, a.name, a.updates)),
  );
  tool(
    "delete_type",
    "Delete a composite type by name.",
    { name: z.string() },
    (a) => mutate((d) => M.deleteType(d, a.name)),
  );

  // ---- database & bulk import/export --------------------------------------
  tool(
    "set_database",
    "Set the diagram's database engine (mysql, postgresql, transactsql, sqlite, mariadb, oraclesql, generic).",
    { database: z.string() },
    (a) => mutate((d) => M.setDatabase(d, a.database)),
  );
  tool(
    "import_diagram",
    "Replace (or extend) the open diagram from a full diagram JSON object.",
    { diagram: z.record(z.string(), z.any()), clearCurrent: z.boolean().optional() },
    (a) =>
      mutate((d) =>
        M.importDiagram(d, a.diagram, { clearCurrent: a.clearCurrent ?? true }),
      ),
  );
  tool(
    "import_dbml",
    "Replace (or extend) the open diagram by importing DBML.",
    { dbml: z.string(), clearCurrent: z.boolean().optional() },
    (a) =>
      mutate((d) =>
        M.applyDbml(d, a.dbml, { clearCurrent: a.clearCurrent ?? true }),
      ),
  );
  tool(
    "export_dbml",
    "Export the open diagram as DBML text.",
    {},
    () => M.exportDbml(readDoc()),
  );
}
