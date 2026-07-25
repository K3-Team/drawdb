import { Toast } from "@douyinfe/semi-ui";
import { createContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { Action, ObjectType, defaultBlue } from "../data/constants";
import { useSelect, useTransform, useUndoRedo, useCollab } from "../hooks";

export const AreasContext = createContext(null);

export default function AreasContextProvider({ children }) {
  const { t } = useTranslation();
  const [areas, setAreas] = useState([]);
  const { transform } = useTransform();
  const { selectedElement, setSelectedElement } = useSelect();
  const { setUndoStack, setRedoStack } = useUndoRedo();
  const { emitDelta, isApplyingRemoteRef } = useCollab();
  const shouldEmit = () => !isApplyingRemoteRef?.current;

  // Stable ids: never reused, never renumbered. Restoring a deleted area (its
  // id is now free) keeps that id; a fresh create or a duplicate/paste (whose
  // id would collide) gets max(id)+1.
  const nextAreaId = () =>
    areas.length ? Math.max(...areas.map((a) => a.id)) + 1 : 0;

  const addArea = (data, addToHistory = true) => {
    const isRestore =
      data && data.id != null && !areas.some((a) => a.id === data.id);
    let created;
    if (data) {
      created = isRestore ? data : { ...data, id: nextAreaId() };
    } else {
      const width = 200;
      const height = 200;
      const id = nextAreaId();
      created = {
        id,
        name: `area_${id}`,
        x: transform.pan.x - width / 2,
        y: transform.pan.y - height / 2,
        width,
        height,
        color: defaultBlue,
        locked: false,
      };
    }
    setAreas((prev) => [...prev, created]);
    if (addToHistory) {
      setUndoStack((prev) => [
        ...prev,
        {
          action: Action.ADD,
          element: ObjectType.AREA,
          message: t("add_area"),
        },
      ]);
      setRedoStack([]);
    }
    if (shouldEmit() && created) {
      emitDelta({
        target: "area",
        action: "create",
        entityId: created.id,
        data: [created],
      });
    }
  };

  const deleteArea = (id, addToHistory = true) => {
    if (addToHistory) {
      const area = areas.find((e) => e.id === id);
      Toast.success(t("area_deleted"));
      setUndoStack((prev) => [
        ...prev,
        {
          action: Action.DELETE,
          element: ObjectType.AREA,
          data: area,
          message: t("delete_area", { areaName: area.name }),
        },
      ]);
      setRedoStack([]);
    }
    setAreas((prev) => prev.filter((e) => e.id !== id));
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
        target: "area",
        action: "delete",
        entityId: id,
        data: [id],
      });
    }
  };

  const updateArea = (id, values) => {
    setAreas((prev) =>
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
        target: "area",
        action: "update",
        entityId: id,
        data: [id, values],
      });
    }
  };

  return (
    <AreasContext.Provider
      value={{
        areas,
        setAreas,
        updateArea,
        addArea,
        deleteArea,
        areasCount: areas.length,
      }}
    >
      {children}
    </AreasContext.Provider>
  );
}
