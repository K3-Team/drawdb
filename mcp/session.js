import { createRestClient } from "./restClient.js";
import { createCollabClient } from "./collabClient.js";
import { emptyDocument } from "./mutators/index.js";

// Per-MCP-session state: the authenticated identity/token and the single
// currently-open diagram (a live collabClient). Tools act on the open diagram;
// list/create/delete use REST. `token`/`identity` come from the Bearer token
// presented on the MCP `initialize` request, so downstream collab writes act
// as that drawDB user and appear in presence.

export function createSession({
  collabHttpUrl,
  collabWsUrl,
  token,
  origin,
  identity,
}) {
  const rest = createRestClient({ baseUrl: collabHttpUrl, token });
  let active = null; // { diagramId, client }

  const participant = identity
    ? {
        clientId: "mcp",
        displayName: identity.displayName,
        color: identity.color ?? "#7c3aed",
      }
    : undefined;

  return {
    identity,

    listDiagrams() {
      return rest.list();
    },

    async createDiagram({ name, database = "generic" }) {
      const created = await rest.create({
        name,
        document: emptyDocument(database),
      });
      await this.openDiagram(created.id);
      return { id: created.id, name: created.name, database };
    },

    async openDiagram(diagramId) {
      // Confirm existence (and access) before opening a room; REST 404s cleanly.
      await rest.get(diagramId);
      if (active) {
        active.client.close();
        active = null;
      }
      const client = createCollabClient({
        url: collabWsUrl,
        diagramId,
        token,
        origin,
        ...(participant ? { participant } : {}),
      });
      await client.connect();
      active = { diagramId, client };
      return { diagramId };
    },

    requireActive() {
      if (!active)
        throw new Error(
          "No diagram is open. Call open_diagram or create_diagram first.",
        );
      return active.client;
    },

    activeDiagramId() {
      return active?.diagramId ?? null;
    },

    close() {
      if (active) active.client.close();
      active = null;
    },
  };
}
