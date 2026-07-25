import { createContext, useState, useCallback } from "react";
import {
  Action,
  ObjectType,
  defaultNoteTheme,
  noteWidth,
} from "../data/constants";
import { useUndoRedo, useTransform, useSelect, useCollab } from "../hooks";
import { Toast } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";

export const NotesContext = createContext(null);

export default function NotesContextProvider({ children }) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState([]);
  const { transform } = useTransform();
  const { setUndoStack, setRedoStack } = useUndoRedo();
  const { selectedElement, setSelectedElement } = useSelect();
  const { emitDelta, isApplyingRemoteRef } = useCollab();
  const shouldEmit = () => !isApplyingRemoteRef?.current;

  // Stable ids: never reused, never renumbered. Restoring a deleted note (its
  // id is now free) keeps that id; a fresh create or a duplicate/paste (whose
  // id would collide) gets max(id)+1.
  const nextNoteId = () =>
    notes.length ? Math.max(...notes.map((n) => n.id)) + 1 : 0;

  const addNote = (data, addToHistory = true) => {
    const isRestore =
      data && data.id != null && !notes.some((n) => n.id === data.id);
    let created;
    if (data) {
      created = isRestore ? data : { ...data, id: nextNoteId() };
    } else {
      const height = 88;
      const id = nextNoteId();
      created = {
        id,
        x: transform.pan.x,
        y: transform.pan.y - height / 2,
        title: `note_${id}`,
        content: "",
        locked: false,
        color: defaultNoteTheme,
        height,
        width: noteWidth,
      };
    }
    setNotes((prev) => [...prev, created]);
    if (addToHistory) {
      setUndoStack((prev) => [
        ...prev,
        {
          action: Action.ADD,
          element: ObjectType.NOTE,
          message: t("add_note"),
        },
      ]);
      setRedoStack([]);
    }
    if (shouldEmit() && created) {
      emitDelta({
        target: "note",
        action: "create",
        entityId: created.id,
        data: [created],
      });
    }
  };

  const deleteNote = (id, addToHistory = true) => {
    if (addToHistory) {
      const note = notes.find((e) => e.id === id);
      Toast.success(t("note_deleted"));
      setUndoStack((prev) => [
        ...prev,
        {
          action: Action.DELETE,
          element: ObjectType.NOTE,
          data: note,
          message: t("delete_note", { noteTitle: note.title }),
        },
      ]);
      setRedoStack([]);
    }
    setNotes((prev) => prev.filter((e) => e.id !== id));
    if (id === selectedElement.id) {
      setSelectedElement((prev) => ({
        ...prev,
        element: ObjectType.NONE,
        id: -1,
        open: false,
      }));
    }
    if (shouldEmit()) {
      emitDelta({
        target: "note",
        action: "delete",
        entityId: id,
        data: [id],
      });
    }
  };

  const updateNote = useCallback(
    (id, values) => {
      setNotes((prev) =>
        prev.map((t) => {
          if (t.id === id) {
            return {
              ...t,
              ...values,
            };
          }
          return t;
        }),
      );
      if (shouldEmit()) {
        emitDelta({
          target: "note",
          action: "update",
          entityId: id,
          data: [id, values],
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [emitDelta],
  );

  return (
    <NotesContext.Provider
      value={{
        notes,
        setNotes,
        updateNote,
        addNote,
        deleteNote,
        notesCount: notes.length,
      }}
    >
      {children}
    </NotesContext.Provider>
  );
}
