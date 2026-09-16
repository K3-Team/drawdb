import {
  Row,
  Col,
  Select,
  Button,
  Input,
  Collapse,
  Card,
} from "@douyinfe/semi-ui";
import {
  IconClose,
  IconDeleteStroked,
  IconPlus,
} from "@douyinfe/semi-icons";
import {
  Cardinality,
  Constraint,
  Action,
  ObjectType,
  RelationshipKind,
  Participation,
} from "../../../data/constants";
import { useDiagram, useLayout, useUndoRedo } from "../../../hooks";
import { getRelationshipFields } from "../../../utils/utils";
import {
  isSubtype,
  siblingsOf,
  childMin,
  subtypeName,
} from "../../../utils/specialization";
import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";

export default function RelationshipInfo({ data }) {
  const { setUndoStack, setRedoStack } = useUndoRedo();
  const { tables, relationships, deleteRelationship, updateRelationship } =
    useDiagram();
  const { t } = useTranslation();
  const { layout } = useLayout();
  const [editField, setEditField] = useState({});

  const startTable = useMemo(
    () => tables.find((tb) => tb.id === data.startTableId),
    [tables, data.startTableId],
  );
  const endTable = useMemo(
    () => tables.find((tb) => tb.id === data.endTableId),
    [tables, data.endTableId],
  );

  const pairs = useMemo(() => getRelationshipFields(data), [data]);

  const startTableName = startTable?.name ?? "";
  const endTableName = endTable?.name ?? "";

  const startFieldOptions = (startTable?.fields ?? []).map((f) => ({
    label: f.name,
    value: f.id,
  }));
  const endFieldOptions = (endTable?.fields ?? []).map((f) => ({
    label: f.name,
    value: f.id,
  }));

  const maxPairs = Math.min(
    startTable?.fields?.length ?? 0,
    endTable?.fields?.length ?? 0,
  );

  const commitPairs = (newPairs, extra = "[fields]") => {
    if (layout.readOnly) return;
    const undo = {
      fields: pairs.map((p) => ({ ...p })),
      startFieldId: data.startFieldId,
      endFieldId: data.endFieldId,
    };
    const redo = {
      fields: newPairs.map((p) => ({ ...p })),
      startFieldId: newPairs[0].startFieldId,
      endFieldId: newPairs[0].endFieldId,
    };
    setUndoStack((prev) => [
      ...prev,
      {
        action: Action.EDIT,
        element: ObjectType.RELATIONSHIP,
        rid: data.id,
        undo,
        redo,
        message: t("edit_relationship", {
          refName: data.name,
          extra,
        }),
      },
    ]);
    setRedoStack([]);
    updateRelationship(data.id, redo);
  };

  const changePairField = (index, side, value) => {
    const newPairs = pairs.map((p, i) =>
      i === index ? { ...p, [`${side}FieldId`]: value } : { ...p },
    );
    commitPairs(newPairs);
  };

  const addPair = () => {
    const newPairs = [
      ...pairs.map((p) => ({ ...p })),
      {
        startFieldId: startTable?.fields?.[0]?.id,
        endFieldId: endTable?.fields?.[0]?.id,
      },
    ];
    commitPairs(newPairs, "[add field]");
  };

  const removePair = (index) => {
    if (pairs.length <= 1) return;
    const newPairs = pairs
      .filter((_, i) => i !== index)
      .map((p) => ({ ...p }));
    commitPairs(newPairs, "[remove field]");
  };

  const swapKeys = () => {
    if (layout.readOnly) return;
    const swappedPairs = pairs.map((p) => ({
      startFieldId: p.endFieldId,
      endFieldId: p.startFieldId,
    }));
    const redo = {
      name: `fk_${endTableName}_${
        endTable?.fields?.find((f) => f.id === data.endFieldId)?.name ?? ""
      }_${startTableName}`,
      startTableId: data.endTableId,
      endTableId: data.startTableId,
      fields: swappedPairs,
      startFieldId: swappedPairs[0].startFieldId,
      endFieldId: swappedPairs[0].endFieldId,
    };
    setUndoStack((prev) => [
      ...prev,
      {
        action: Action.EDIT,
        element: ObjectType.RELATIONSHIP,
        rid: data.id,
        undo: {
          name: data.name,
          startTableId: data.startTableId,
          endTableId: data.endTableId,
          fields: pairs.map((p) => ({ ...p })),
          startFieldId: data.startFieldId,
          endFieldId: data.endFieldId,
        },
        redo,
        message: t("edit_relationship", {
          refName: data.name,
          extra: "[swap keys]",
        }),
      },
    ]);
    setRedoStack([]);
    updateRelationship(data.id, redo);
  };

  const changeCardinality = (value) => {
    if (layout.readOnly) return;

    setUndoStack((prev) => [
      ...prev,
      {
        action: Action.EDIT,
        element: ObjectType.RELATIONSHIP,
        rid: data.id,
        undo: { cardinality: data.cardinality },
        redo: { cardinality: value },
        message: t("edit_relationship", {
          refName: data.name,
          extra: "[cardinality]",
        }),
      },
    ]);
    setRedoStack([]);
    updateRelationship(data.id, { cardinality: value });
  };

  const changeConstraint = (key, value) => {
    if (layout.readOnly) return;

    const undoKey = `${key}Constraint`;
    setUndoStack((prev) => [
      ...prev,
      {
        action: Action.EDIT,
        element: ObjectType.RELATIONSHIP,
        rid: data.id,
        undo: { [undoKey]: data[undoKey] },
        redo: { [undoKey]: value },
        message: t("edit_relationship", {
          refName: data.name,
          extra: "[constraint]",
        }),
      },
    ]);
    setRedoStack([]);
    updateRelationship(data.id, { [undoKey]: value });
  };

  const subtype = isSubtype(data);
  const siblings = useMemo(
    () => siblingsOf(relationships, data),
    [relationships, data],
  );
  const siblingNames = siblings
    .filter((r) => r.id !== data.id)
    .map((r) => r.name)
    .join(", ");
  const startPk = startTable?.fields?.find((f) => f.primary);
  const endPk = endTable?.fields?.find((f) => f.primary);

  const pushEdit = (undo, redo, extra) => {
    setUndoStack((prev) => [
      ...prev,
      {
        action: Action.EDIT,
        element: ObjectType.RELATIONSHIP,
        rid: data.id,
        undo,
        redo,
        message: t("edit_relationship", { refName: data.name, extra }),
      },
    ]);
    setRedoStack([]);
    updateRelationship(data.id, redo);
  };

  const changeKind = (value) => {
    if (layout.readOnly) return;
    if (value === RelationshipKind.SUBTYPE) {
      const redo = {
        kind: RelationshipKind.SUBTYPE,
        cardinality: Cardinality.ONE_TO_ONE,
        deleteConstraint:
          data.deleteConstraint === Constraint.NONE
            ? Constraint.CASCADE
            : data.deleteConstraint,
        participation: undefined,
        subtype: data.subtype ?? { group: "", disjoint: false, total: false },
        name: data.name?.startsWith("fk_")
          ? subtypeName(startTableName, endTableName)
          : data.name,
      };
      if (startPk && endPk) {
        redo.startFieldId = startPk.id;
        redo.endFieldId = endPk.id;
        redo.fields = [{ startFieldId: startPk.id, endFieldId: endPk.id }];
      }
      const undo = {
        kind: data.kind,
        cardinality: data.cardinality,
        deleteConstraint: data.deleteConstraint,
        participation: data.participation,
        subtype: data.subtype,
        name: data.name,
        startFieldId: data.startFieldId,
        endFieldId: data.endFieldId,
        fields: pairs.map((p) => ({ ...p })),
      };
      pushEdit(undo, redo, "[kind]");
    } else {
      const startFieldName = startTable?.fields?.find(
        (f) => f.id === data.startFieldId,
      )?.name;
      const redo = { kind: undefined, subtype: undefined };
      if (data.name?.startsWith("is_a_")) {
        redo.name = `fk_${startTableName}_${startFieldName ?? ""}_${endTableName}`;
      }
      pushEdit(
        { kind: data.kind, subtype: data.subtype, name: data.name },
        redo,
        "[kind]",
      );
    }
  };

  // Rewrites the subtype block on this link and every sibling in one undo entry.
  const changeSpecialisation = (patch, extra) => {
    if (layout.readOnly) return;
    const next = { ...data.subtype, ...patch };
    const targets = siblings.length ? siblings : [data];
    const batch = targets.map((r) => ({
      rid: r.id,
      undo: { subtype: r.subtype },
      redo: { subtype: { ...next } },
    }));
    setUndoStack((prev) => [
      ...prev,
      {
        action: Action.EDIT,
        element: ObjectType.RELATIONSHIP,
        rid: data.id,
        batch,
        undo: { subtype: data.subtype },
        redo: { subtype: { ...next } },
        message: t("edit_relationship", { refName: data.name, extra }),
      },
    ]);
    setRedoStack([]);
    for (const item of batch) updateRelationship(item.rid, item.redo);
  };

  const changeParticipation = (value) => {
    if (layout.readOnly) return;
    const redo =
      value === "default"
        ? { participation: undefined }
        : { participation: { end: value } };
    pushEdit({ participation: data.participation }, redo, "[participation]");
  };

  return (
    <>
      <div className="flex items-center mb-2.5">
        <div className="text-md font-semibold break-keep">{t("name")}: </div>
        <Input
          value={data.name}
          validateStatus={data.name.trim() === "" ? "error" : "default"}
          placeholder={t("name")}
          className="ms-2"
          readonly={layout.readOnly}
          onChange={(value) => updateRelationship(data.id, { name: value })}
          onFocus={(e) => setEditField({ name: e.target.value })}
          onBlur={(e) => {
            if (e.target.value === editField.name) return;
            setUndoStack((prev) => [
              ...prev,
              {
                action: Action.EDIT,
                element: ObjectType.RELATIONSHIP,
                component: "self",
                rid: data.id,
                undo: editField,
                redo: { name: e.target.value },
                message: t("edit_relationship", {
                  refName: e.target.value,
                  extra: "[name]",
                }),
              },
            ]);
            setRedoStack([]);
          }}
        />
      </div>
      <div className="flex justify-between items-center mb-1">
        <div className="me-3">
          <span className="font-semibold">{t("primary")}: </span>
          {endTableName}
        </div>
        <div className="mx-1">
          <span className="font-semibold">{t("foreign")}: </span>
          {startTableName}
        </div>
        <Button
          icon={<i className="bi bi-arrow-left-right" />}
          type="tertiary"
          size="small"
          onClick={swapKeys}
          disabled={layout.readOnly}
          title={t("swap")}
        />
      </div>

      <div className="font-semibold my-1">{t("relationship_kind")}:</div>
      <Select
        optionList={[
          { label: t("kind_fk"), value: RelationshipKind.FK },
          { label: t("kind_subtype"), value: RelationshipKind.SUBTYPE },
        ]}
        value={subtype ? RelationshipKind.SUBTYPE : RelationshipKind.FK}
        className="w-full mb-2"
        disabled={layout.readOnly}
        onChange={changeKind}
      />

      {!subtype && (
        <>
          <div className="font-semibold my-1">{t("cardinality")}:</div>
          <Select
            optionList={Object.values(Cardinality).map((v) => ({
              label: t(v),
              value: v,
            }))}
            value={data.cardinality}
            className="w-full"
            onChange={changeCardinality}
          />

          {data.cardinality !== Cardinality.ONE_TO_ONE && (
            <>
              <div className="text-md font-semibold break-keep mt-2">
                {t("many_side_label")}:
              </div>
              <Input
                value={data.manyLabel}
                placeholder={t("label")}
                onChange={(value) => updateRelationship(data.id, { manyLabel: value })}
                onFocus={(e) => setEditField({ manyLabel: e.target.value })}
                readonly={layout.readOnly}
                onBlur={(e) => {
                  if (e.target.value === editField.manyLabel) return;
                  setUndoStack((prev) => [
                    ...prev,
                    {
                      action: Action.EDIT,
                      element: ObjectType.RELATIONSHIP,
                      component: "self",
                      rid: data.id,
                      undo: editField,
                      redo: { manyLabel: e.target.value },
                      message: t("edit_relationship", {
                        refName: e.target.value,
                        extra: "[manyLabel]",
                      }),
                    },
                  ]);
                  setRedoStack([]);
                }}
              />
            </>
          )}

          <Row gutter={6} className="my-3">
            <Col span={12}>
              <div className="font-semibold">{t("on_update")}: </div>
              <Select
                optionList={Object.values(Constraint).map((v) => ({
                  label: v,
                  value: v,
                }))}
                value={data.updateConstraint}
                className="w-full"
                onChange={(value) => changeConstraint("update", value)}
              />
            </Col>
            <Col span={12}>
              <div className="font-semibold">{t("on_delete")}: </div>
              <Select
                optionList={Object.values(Constraint).map((v) => ({
                  label: v,
                  value: v,
                }))}
                value={data.deleteConstraint}
                className="w-full"
                onChange={(value) => changeConstraint("delete", value)}
              />
            </Col>
          </Row>
        </>
      )}

      {subtype && (
        <Card
          bodyStyle={{ padding: "8px" }}
          style={{ marginTop: "12px", marginBottom: "12px" }}
          headerLine={false}
          title={t("specialisation")}
        >
          <div className="font-semibold my-1">{t("specialisation_group")}:</div>
          <Input
            value={data.subtype?.group ?? ""}
            readonly={layout.readOnly}
            onChange={(raw) => {
              const value = raw.replace(/["`\]\n\t;]/g, "");
              updateRelationship(data.id, {
                subtype: { ...data.subtype, group: value },
              });
            }}
            onFocus={(e) => setEditField({ group: e.target.value })}
            onBlur={(e) => {
              const group = e.target.value;
              if (group === editField.group) return;
              const peer = relationships.find(
                (r) =>
                  r.id !== data.id &&
                  isSubtype(r) &&
                  String(r.endTableId) === String(data.endTableId) &&
                  (r.subtype?.group ?? "") === group,
              );
              changeSpecialisation(
                peer
                  ? {
                      group,
                      disjoint: peer.subtype.disjoint,
                      total: peer.subtype.total,
                      discriminatorFieldId: peer.subtype.discriminatorFieldId,
                    }
                  : { group },
                "[group]",
              );
            }}
          />
          <Row gutter={6} className="my-2">
            <Col span={12}>
              <Select
                optionList={[
                  { label: t("disjoint"), value: "disjoint" },
                  { label: t("overlapping"), value: "overlapping" },
                ]}
                value={data.subtype?.disjoint ? "disjoint" : "overlapping"}
                className="w-full"
                disabled={layout.readOnly}
                onChange={(v) => changeSpecialisation({ disjoint: v === "disjoint" }, "[disjoint]")}
              />
            </Col>
            <Col span={12}>
              <Select
                optionList={[
                  { label: t("total"), value: "total" },
                  { label: t("partial"), value: "partial" },
                ]}
                value={data.subtype?.total ? "total" : "partial"}
                className="w-full"
                disabled={layout.readOnly}
                onChange={(v) => changeSpecialisation({ total: v === "total" }, "[total]")}
              />
            </Col>
          </Row>
          <div className="font-semibold my-1">{t("discriminator")}:</div>
          <Select
            optionList={[
              { label: t("no_discriminator"), value: "" },
              ...endFieldOptions.filter(
                (o) => !endTable?.fields?.find((f) => f.id === o.value)?.primary,
              ),
            ]}
            value={data.subtype?.discriminatorFieldId ?? ""}
            className="w-full"
            disabled={layout.readOnly}
            onChange={(v) =>
              changeSpecialisation(
                { discriminatorFieldId: v === "" ? undefined : v },
                "[discriminator]",
              )
            }
          />
          {siblingNames && (
            <div className="text-color opacity-70 mt-2 text-xs">
              {t("sibling_sync_hint", { names: siblingNames })}
            </div>
          )}
        </Card>
      )}

      {!subtype && (
        <Card
          bodyStyle={{ padding: "8px" }}
          style={{ marginTop: "12px", marginBottom: "12px" }}
          headerLine={false}
          title={t("participation")}
        >
          <Row gutter={6}>
            <Col span={12}>
              <div className="font-semibold">{startTableName}:</div>
              <Input
                value={childMin(data, tables) === 1 ? t("mandatory") : t("optional")}
                readonly
                disabled
              />
              <div className="text-color opacity-70 mt-1 text-xs">
                {t("child_participation_hint")}
              </div>
            </Col>
            <Col span={12}>
              <div className="font-semibold">{endTableName}:</div>
              <Select
                optionList={[
                  { label: t("participation_default"), value: "default" },
                  { label: t("mandatory"), value: Participation.MANDATORY },
                  { label: t("optional"), value: Participation.OPTIONAL },
                ]}
                value={data.participation?.end ?? "default"}
                className="w-full"
                disabled={layout.readOnly}
                onChange={changeParticipation}
              />
            </Col>
          </Row>
        </Card>
      )}

      <Card
        bodyStyle={{ padding: "4px" }}
        style={{ marginTop: "12px", marginBottom: "12px" }}
        headerLine={false}
      >
        <Collapse keepDOM={false} lazyRender accordion>
          <Collapse.Panel header={t("composite_key")} itemKey="1">
            <div className="pb-4">
              <div className="text-color opacity-70 mb-3">
                {t("composite_key_hint")}
              </div>
              <div className="grid grid-cols-[1fr_1fr_32px] gap-2 items-center mb-2">
                <div className="text-xs font-semibold text-color">
                  {t("foreign")}
                </div>
                <div className="text-xs font-semibold text-color">
                  {t("primary")}
                </div>
                <div />
              </div>
              {pairs.map((pair, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_1fr_32px] gap-2 items-center mb-2.5"
                >
                  <Select
                    optionList={startFieldOptions}
                    value={pair.startFieldId}
                    className="w-full"
                    disabled={layout.readOnly}
                    onChange={(value) => changePairField(i, "start", value)}
                  />
                  <Select
                    optionList={endFieldOptions}
                    value={pair.endFieldId}
                    className="w-full"
                    disabled={layout.readOnly}
                    onChange={(value) => changePairField(i, "end", value)}
                  />
                  <Button
                    icon={
                      <IconClose
                        size="small"
                        style={{ color: "var(--semi-color-danger)" }}
                      />
                    }
                    type="tertiary"
                    disabled={layout.readOnly || pairs.length <= 1}
                    onClick={() => removePair(i)}
                  />
                </div>
              ))}
              <Button
                block
                icon={<IconPlus />}
                onClick={addPair}
                disabled={layout.readOnly || pairs.length >= maxPairs}
                className="mt-1"
              >
                {t("add_field")}
              </Button>
            </div>
          </Collapse.Panel>
        </Collapse>
      </Card>

      <Button
        block
        type="danger"
        disabled={layout.readOnly}
        icon={<IconDeleteStroked />}
        onClick={() => deleteRelationship(data.id)}
      >
        {t("delete")}
      </Button>
    </>
  );
}
