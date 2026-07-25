// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useElementPointerDown } from "./useElementPointerDown";

// The canvas drag-start tracker. An element press registers the element; the
// canvas press consumes it. The consume-clears behaviour is what prevents a
// press on empty canvas from picking up the previously-pressed element.
describe("useElementPointerDown", () => {
  const table = { element: { id: "t1" }, type: "table" };
  const note = { element: { id: 2 }, type: "note" };

  it("press-element then press-canvas: consume returns the element", () => {
    const { result } = renderHook(() => useElementPointerDown());
    result.current.register(table);
    expect(result.current.consume()).toEqual(table);
  });

  it("consume clears it: a following press on empty canvas sees nothing", () => {
    const { result } = renderHook(() => useElementPointerDown());
    result.current.register(table);
    result.current.consume(); // canvas handler for the element press
    expect(result.current.consume()).toBe(null); // next press, no element
  });

  it("consume with no prior element press is null", () => {
    const { result } = renderHook(() => useElementPointerDown());
    expect(result.current.consume()).toBe(null);
  });

  it("a second element press overwrites the first", () => {
    const { result } = renderHook(() => useElementPointerDown());
    result.current.register(table);
    result.current.register(note);
    expect(result.current.consume()).toEqual(note);
  });

  it("register/consume are stable across renders (so React.memo can hold)", () => {
    const { result, rerender } = renderHook(() => useElementPointerDown());
    const before = result.current;
    rerender();
    expect(result.current.register).toBe(before.register);
    expect(result.current.consume).toBe(before.consume);
  });
});
