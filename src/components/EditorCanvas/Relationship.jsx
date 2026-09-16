import { memo, useMemo, useRef, useState, useEffect } from "react";
import { ObjectType, Tab, darkBgTheme } from "../../data/constants";
import { badgeTexts, isSubtype } from "../../utils/specialization";
import { calcPath, calcCompositePath } from "../../utils/calcPath";
import { useDiagram, useSettings, useLayout, useSelect } from "../../hooks";
import { useTranslation } from "react-i18next";
import { SideSheet } from "@douyinfe/semi-ui";
import RelationshipInfo from "../EditorSidePanel/RelationshipsTab/RelationshipInfo";
import {
  getVisibleFieldIndex,
  getVisibleFields,
  getRelationshipFields,
} from "../../utils/utils";

const labelFontSize = 16;

// Memoized: its only prop is the stable `data` object, so it skips re-rendering
// when Canvas re-renders for unrelated reasons (e.g. pointer moves). It does not
// read the pointer/CanvasContext, so this is a real win for the expensive path
// computation below.
function Relationship({ data }) {
  const { settings } = useSettings();
  const { tables, relationships } = useDiagram();
  const { layout } = useLayout();
  const { selectedElement, setSelectedElement } = useSelect();
  const { t } = useTranslation();

  const pathValues = useMemo(() => {
    const startTable = tables.find((t) => t.id === data.startTableId);
    const endTable = tables.find((t) => t.id === data.endTableId);

    if (!startTable || !endTable || startTable.hidden || endTable.hidden)
      return null;

    const startFields = getVisibleFields(startTable, relationships);
    const endFields = getVisibleFields(endTable, relationships);

    const pairs = getRelationshipFields(data);

    return {
      startFieldIndex: getVisibleFieldIndex(
        startTable,
        data.startFieldId,
        relationships,
      ),
      endFieldIndex: getVisibleFieldIndex(
        endTable,
        data.endFieldId,
        relationships,
      ),
      startFieldIndices: pairs.map((p) =>
        getVisibleFieldIndex(startTable, p.startFieldId, relationships),
      ),
      endFieldIndices: pairs.map((p) =>
        getVisibleFieldIndex(endTable, p.endFieldId, relationships),
      ),
      startTable: {
        x: startTable.x,
        y: startTable.y,
        comment: startTable.comment,
        fields: startFields,
      },
      endTable: {
        x: endTable.x,
        y: endTable.y,
        comment: endTable.comment,
        fields: endFields,
      },
    };
  }, [tables, relationships, data]);

  const isComposite = (pathValues?.startFieldIndices?.length ?? 0) > 1;

  const composite = useMemo(() => {
    if (!pathValues || !isComposite) return null;
    return calcCompositePath(
      {
        startTable: pathValues.startTable,
        endTable: pathValues.endTable,
        startFieldIndices: pathValues.startFieldIndices,
        endFieldIndices: pathValues.endFieldIndices,
      },
      settings.tableWidth,
      1,
      settings.showComments,
    );
  }, [pathValues, isComposite, settings.tableWidth, settings.showComments]);

  const pathRef = useRef();
  const labelRef = useRef();

  const badges = useMemo(() => badgeTexts(data, tables), [data, tables]);
  const cardinalityStart = badges.start;
  const cardinalityEnd = badges.end;
  const subtype = isSubtype(data);
  const total = subtype && !!data.subtype?.total;

  let cardinalityStartX = 0;
  let cardinalityEndX = 0;
  let cardinalityStartY = 0;
  let cardinalityEndY = 0;
  let labelX = 0;
  let labelY = 0;

  let labelWidth = labelRef.current?.getBBox().width ?? 0;
  let labelHeight = labelRef.current?.getBBox().height ?? 0;

  const cardinalityOffset = 28;

  if (composite) {
    labelX = composite.labelPoint.x - (labelWidth ?? 0) / 2;
    labelY = composite.labelPoint.y + (labelHeight ?? 0) / 2;
    cardinalityStartX = composite.startCardinality.x;
    cardinalityStartY = composite.startCardinality.y;
    cardinalityEndX = composite.endCardinality.x;
    cardinalityEndY = composite.endCardinality.y;
  } else if (pathRef.current) {
    const pathLength = pathRef.current.getTotalLength();

    const labelPoint = pathRef.current.getPointAtLength(pathLength / 2);
    labelX = labelPoint.x - (labelWidth ?? 0) / 2;
    labelY = labelPoint.y + (labelHeight ?? 0) / 2;

    const point1 = pathRef.current.getPointAtLength(cardinalityOffset);
    cardinalityStartX = point1.x;
    cardinalityStartY = point1.y;
    const point2 = pathRef.current.getPointAtLength(
      pathLength - cardinalityOffset,
    );
    cardinalityEndX = point2.x;
    cardinalityEndY = point2.y;
  }

  const edit = () => {
    if (!layout.sidebar) {
      setSelectedElement((prev) => ({
        ...prev,
        element: ObjectType.RELATIONSHIP,
        id: data.id,
        open: true,
      }));
    } else {
      setSelectedElement((prev) => ({
        ...prev,
        currentTab: Tab.RELATIONSHIPS,
        element: ObjectType.RELATIONSHIP,
        id: data.id,
        open: true,
      }));
      if (selectedElement.currentTab !== Tab.RELATIONSHIPS) return;
      document
        .getElementById(`scroll_ref_${data.id}`)
        ?.scrollIntoView({ behavior: "smooth" });
    }
  };

  if (!pathValues) return null;

  return (
    <>
      <g className="select-none group" onDoubleClick={edit}>
        {/* invisible wider path for better hover ux */}
        <path
          d={
            composite
              ? composite.path
              : calcPath(
                  pathValues,
                  settings.tableWidth,
                  1,
                  settings.showComments,
                )
          }
          fill="none"
          stroke="transparent"
          strokeWidth={12}
          cursor="pointer"
        />
        {total && (
          <path
            d={
              composite
                ? composite.path
                : calcPath(
                    pathValues,
                    settings.tableWidth,
                    1,
                    settings.showComments,
                  )
            }
            className="relationship-path relationship-path--total-under"
            fill="none"
          />
        )}
        <path
          ref={pathRef}
          d={
            composite
              ? composite.path
              : calcPath(
                  pathValues,
                  settings.tableWidth,
                  1,
                  settings.showComments,
                )
          }
          className={`relationship-path${subtype ? " relationship-path--subtype" : ""}${total ? " relationship-path--total-over" : ""}`}
          style={
            total
              ? { stroke: settings.mode === "dark" ? darkBgTheme : "white" }
              : undefined
          }
          fill="none"
          cursor="pointer"
        />
        {settings.showRelationshipLabels && (
          <text
            x={labelX}
            y={labelY}
            fill={settings.mode === "dark" ? "lightgrey" : "#333"}
            fontSize={labelFontSize}
            fontWeight={500}
            ref={labelRef}
            className="group-hover:fill-sky-600"
          >
            {data.name}
          </text>
        )}
        {(composite || pathRef.current) && settings.showCardinality && (
          <>
            <CardinalityLabel
              x={cardinalityStartX}
              y={cardinalityStartY}
              text={cardinalityStart}
              shape={subtype ? "circle" : "pill"}
            />
            <CardinalityLabel
              x={cardinalityEndX}
              y={cardinalityEndY}
              text={cardinalityEnd}
              shape={subtype ? "circle" : "pill"}
            />
          </>
        )}
      </g>
      <SideSheet
        title={t("edit")}
        size="small"
        visible={
          selectedElement.element === ObjectType.RELATIONSHIP &&
          selectedElement.id === data.id &&
          selectedElement.open &&
          !layout.sidebar
        }
        onCancel={() => {
          setSelectedElement((prev) => ({
            ...prev,
            open: false,
          }));
        }}
        style={{ paddingBottom: "16px" }}
      >
        <div className="sidesheet-theme">
          <RelationshipInfo data={data} />
        </div>
      </SideSheet>
    </>
  );
}

function CardinalityLabel({
  x,
  y,
  text,
  r = 12,
  padding = 14,
  shape = "pill",
}) {
  const [textWidth, setTextWidth] = useState(0);
  const textRef = useRef(null);

  useEffect(() => {
    if (textRef.current) {
      const bbox = textRef.current.getBBox();
      setTextWidth(bbox.width);
    }
  }, [text]);

  const isCircle = shape === "circle";
  const width = isCircle ? r * 2 : textWidth + padding;

  return (
    <g>
      <rect
        x={x - width / 2}
        y={y - r}
        rx={r}
        ry={r}
        width={width}
        height={r * 2}
        fill={isCircle ? "white" : "grey"}
        stroke={isCircle ? "grey" : "none"}
        strokeWidth={isCircle ? 2 : 0}
        className={isCircle ? undefined : "group-hover:fill-sky-600"}
      />
      <text
        ref={textRef}
        x={x}
        y={y}
        fill={isCircle ? "#333" : "white"}
        fontWeight={isCircle ? 700 : 400}
        strokeWidth="0.5"
        textAnchor="middle"
        alignmentBaseline="middle"
      >
        {text}
      </text>
    </g>
  );
}

export default memo(Relationship);
