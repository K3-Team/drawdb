// Thin REST client for the collab server's diagram CRUD endpoints. Used for
// operations that are not per-diagram-room (list / create / delete); live
// editing goes through the WebSocket collab path (collabClient.js) instead.
// REST auth is `Authorization: Bearer <token>` (server/auth.js). The collab
// REST layer performs no Origin check, so no Origin header is needed here.

export function createRestClient({ baseUrl, token }) {
  const base = baseUrl.replace(/\/$/, "");
  const headers = () => ({
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  });

  async function request(method, path, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.json())?.error ?? "";
      } catch {
        /* non-JSON error body */
      }
      throw new Error(
        `${method} ${path} failed: ${res.status}${detail ? ` (${detail})` : ""}`,
      );
    }
    if (res.status === 204) return null;
    return res.json();
  }

  const encode = (id) => encodeURIComponent(id);

  return {
    async list() {
      return (await request("GET", "/api/diagrams")).diagrams;
    },
    get(id) {
      return request("GET", `/api/diagrams/${encode(id)}`);
    },
    create({ name, document }) {
      return request("POST", "/api/diagrams", { name, document });
    },
    delete(id) {
      return request("DELETE", `/api/diagrams/${encode(id)}`);
    },
  };
}
