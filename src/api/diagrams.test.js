import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { diagramApi } from "./diagrams";

function fakeStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

function mockResponse({ status = 200, ok = status < 400, body = {} } = {}) {
  return { status, ok, json: async () => body };
}

describe("diagramApi request headers", () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.localStorage = fakeStorage();
  });

  afterEach(() => {
    globalThis.localStorage = originalLocalStorage;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("adds an Authorization header when a token is stored", async () => {
    localStorage.setItem("drawdb-collab-token", "abc123");
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(mockResponse({ body: { diagrams: [] } }));

    await diagramApi.list();

    const [, options] = globalThis.fetch.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer abc123");
  });

  it("omits the Authorization header when no token is stored", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(mockResponse({ body: { diagrams: [] } }));

    await diagramApi.list();

    const [, options] = globalThis.fetch.mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
  });

  it("throws an error with status 401 on an unauthorized response", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        mockResponse({ status: 401, body: { error: "unauthorized" } }),
      );

    await expect(diagramApi.list()).rejects.toMatchObject({ status: 401 });
  });

  it("preserves method/headers/body options passed by create/update/delete", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(mockResponse({ body: { id: "x", version: 1 } }));
    localStorage.setItem("drawdb-collab-token", "tok");

    await diagramApi.create({ id: "x", name: "n", document: { a: 1 } });

    const [url, options] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("/api/diagrams");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(options.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(options.body)).toEqual({
      id: "x",
      name: "n",
      document: { a: 1 },
    });
  });
});
