// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useContext } from "react";
import NotesContextProvider, { NotesContext } from "./NotesContext";
import AreasContextProvider, { AreasContext } from "./AreasContext";

// Notes and areas moved from array-index ids (renumbered on every add/delete,
// which shifted every held id) to STABLE ids: never reused, never renumbered.
// Guard that invariant, since the id backs undo/redo, duplicate/paste, and the
// canvas <-> side-panel selection.
vi.mock("../hooks", () => ({
  useUndoRedo: () => ({ setUndoStack: vi.fn(), setRedoStack: vi.fn() }),
  useTransform: () => ({ transform: { pan: { x: 0, y: 0 } } }),
  useSelect: () => ({
    selectedElement: { id: -1 },
    setSelectedElement: vi.fn(),
  }),
  useCollab: () => ({
    emitDelta: vi.fn(),
    isApplyingRemoteRef: { current: false },
  }),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k) => k }) }));
vi.mock("@douyinfe/semi-ui", () => ({ Toast: { success: vi.fn() } }));

const cases = [
  { name: "notes", Provider: NotesContextProvider, Context: NotesContext,
    add: (c) => c.addNote, del: (c) => c.deleteNote, list: (c) => c.notes },
  { name: "areas", Provider: AreasContextProvider, Context: AreasContext,
    add: (c) => c.addArea, del: (c) => c.deleteArea, list: (c) => c.areas },
];

for (const { name, Provider, Context, add, del, list } of cases) {
  describe(`${name} stable ids`, () => {
    const render = () =>
      renderHook(() => useContext(Context), {
        wrapper: ({ children }) => <Provider>{children}</Provider>,
      });

    it("does not renumber on delete; a new id is max+1", () => {
      const { result } = render();
      act(() => add(result.current)());
      act(() => add(result.current)());
      act(() => add(result.current)());
      expect(list(result.current).map((e) => e.id)).toEqual([0, 1, 2]);

      act(() => del(result.current)(1)); // delete the middle one
      expect(list(result.current).map((e) => e.id)).toEqual([0, 2]);

      act(() => add(result.current)()); // max+1, never reuse 1
      expect(list(result.current).map((e) => e.id)).toEqual([0, 2, 3]);
    });

    it("restoring a deleted element (undo) keeps its original id", () => {
      const { result } = render();
      act(() => add(result.current)());
      act(() => add(result.current)());
      let deleted;
      act(() => {
        deleted = list(result.current).find((e) => e.id === 0);
        del(result.current)(0);
      });
      expect(list(result.current).map((e) => e.id)).toEqual([1]);

      act(() => add(result.current)(deleted, false)); // undo-restore
      expect(list(result.current).map((e) => e.id).sort()).toEqual([0, 1]);
    });

    it("duplicate/paste (id already present) gets a fresh id, not a collision", () => {
      const { result } = render();
      act(() => add(result.current)());
      act(() => add(result.current)());
      // pass an object whose id collides with an existing element
      act(() => add(result.current)({ id: 0, x: 5, y: 5 }, false));
      const ids = list(result.current).map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length); // all unique
      expect(ids).toContain(2); // fresh max+1
    });
  });
}
