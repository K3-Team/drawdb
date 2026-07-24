// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useContext } from "react";
import CollabContextProvider, { CollabContext } from "./CollabContext";

// The 520-line client half of the collaboration protocol (mirror of
// server/websocket.js) had zero coverage. Drive it headlessly with a mock
// WebSocket: assert it JOINs, adopts the server identity, applies snapshots and
// remote operations, resolves/rejects pending saves, and tracks presence,
// locks, and cursors. A regression here silently breaks real-time editing.

class MockWebSocket {
  static OPEN = 1;
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.onopen = this.onmessage = this.onclose = this.onerror = null;
    MockWebSocket.instances.push(this);
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  triggerOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
  emit(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  get lastSent() {
    return this.sent[this.sent.length - 1];
  }
}

const wrapper = ({ children }) => (
  <CollabContextProvider>{children}</CollabContextProvider>
);

// Render, connect, open the socket, and complete the JOIN handshake. Returns
// the hook result, the mock socket, and the connect callbacks.
function connected({ version = 5, clientId = "server-cid" } = {}) {
  const { result } = renderHook(() => useContext(CollabContext), { wrapper });
  const onSnapshot = vi.fn();
  const onDelta = vi.fn();
  act(() => result.current.connect({ diagramId: "d1", version: 0, onSnapshot, onDelta }));
  const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  act(() => socket.triggerOpen());
  act(() =>
    socket.emit({ type: "joined", version, clientId, displayName: "AI", color: "#000" }),
  );
  return { result, socket, onSnapshot, onDelta };
}

beforeEach(() => {
  MockWebSocket.instances = [];
  global.WebSocket = MockWebSocket;
  sessionStorage.clear();
  localStorage.clear();
});

describe("CollabContext client engine", () => {
  it("sends JOIN on open and reaches CONNECTED on JOINED", () => {
    const { result, socket } = connected({ version: 7 });
    const join = socket.sent[0];
    expect(join.type).toBe("join");
    expect(join.diagramId).toBe("d1");
    expect(result.current.connectionState).toBe("connected");
    expect(result.current.versionRef.current).toBe(7);
  });

  it("applies a SNAPSHOT via onSnapshot and tracks its version", () => {
    const { socket, onSnapshot } = connected();
    const snap = { type: "snapshot", diagramId: "d1", version: 9, name: "N", document: { tables: [] } };
    act(() => socket.emit(snap));
    expect(onSnapshot).toHaveBeenCalledWith(expect.objectContaining({ version: 9 }));
  });

  it("sendSnapshot emits an OPERATION with the current baseVersion and resolves on ack", async () => {
    const { result, socket } = connected({ version: 5, clientId: "server-cid" });
    let pending;
    act(() => {
      pending = result.current.sendSnapshot("My diagram", { tables: [] });
    });
    const op = socket.sent.find((m) => m.type === "operation");
    expect(op.baseVersion).toBe(5);
    expect(op.clientId).toBe("server-cid");
    expect(op.operation).toEqual({
      type: "snapshot.replace",
      payload: { name: "My diagram", document: { tables: [] } },
    });
    act(() =>
      socket.emit({
        type: "operation_applied",
        diagramId: "d1",
        clientId: "server-cid",
        operationId: op.operationId,
        version: 6,
        operation: { payload: { name: "My diagram", document: { tables: [] } } },
      }),
    );
    await expect(pending).resolves.toMatchObject({ version: 6 });
    expect(result.current.versionRef.current).toBe(6);
  });

  it("applies a remote OPERATION_APPLIED (other client) via onSnapshot", () => {
    const { socket, onSnapshot } = connected({ clientId: "me" });
    act(() =>
      socket.emit({
        type: "operation_applied",
        diagramId: "d1",
        clientId: "someone-else",
        operationId: "x",
        version: 10,
        operation: { payload: { name: "N", document: { tables: [{ id: "t" }] } } },
      }),
    );
    expect(onSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ version: 10, document: { tables: [{ id: "t" }] } }),
    );
  });

  it("rejects a pending save on RESYNC_REQUIRED and re-applies the snapshot", async () => {
    const { result, socket, onSnapshot } = connected({ version: 5 });
    let pending;
    act(() => {
      pending = result.current.sendSnapshot("N", { tables: [] });
      pending.catch(() => {}); // avoid unhandled rejection before assertion
    });
    act(() =>
      socket.emit({
        type: "resync_required",
        diagramId: "d1",
        version: 12,
        name: "N",
        document: { tables: [] },
      }),
    );
    await expect(pending).rejects.toMatchObject({ type: "resync_required" });
    expect(onSnapshot).toHaveBeenCalledWith(expect.objectContaining({ version: 12 }));
    expect(result.current.versionRef.current).toBe(12);
  });

  it("tracks presence, table locks, and remote cursors", () => {
    const { result, socket } = connected({ clientId: "me" });
    act(() =>
      socket.emit({
        type: "presence",
        diagramId: "d1",
        participants: [{ clientId: "a", displayName: "A", color: "#000" }],
      }),
    );
    expect(result.current.participants).toHaveLength(1);

    act(() =>
      socket.emit({
        type: "table_lock_state",
        diagramId: "d1",
        locks: [{ tableId: "t1", clientId: "a", displayName: "A", token: "tok" }],
      }),
    );
    expect(result.current.tableLocks.t1).toBeTruthy();
    expect(result.current.isTableLockedByOther("t1")).toBe(true);

    act(() =>
      socket.emit({
        type: "cursor",
        diagramId: "d1",
        clientId: "a",
        x: 10,
        y: 20,
        selected: null,
      }),
    );
    expect(result.current.remoteCursors.a).toMatchObject({ x: 10, y: 20 });
  });
});
